/*
Copyright (c) 2016 Kevin Doughty

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
"use strict";
;(function() {

  var root = this;
  var previousPyon = root.Pyon;
  var Pyon = root.Pyon = (function() {
  //var Pyon = (function() {

    var rAF = window.requestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.mozRequestAnimationFrame ||
      window.msRequestAnimationFrame ||
      window.oRequestAnimationFrame;

    var cAF = window.cancelAnimationFrame ||
      window.webkitCancelRequestAnimationFrame ||
      window.webkitCancelAnimationFrame ||
      window.mozCancelAnimationFrame ||
      window.msCancelAnimationFrame ||
      window.oCancelAnimationFrame;

    function isFunction(w) {
      return w && {}.toString.call(w) === "[object Function]";
    }

    function isNumber(w) {
      return !isNaN(parseFloat(w)) && isFinite(w); // I want infinity for repeat count. Probably not duration
    }



    function ShoeTransaction(settings,automaticallyCommit) {
      this.time = performance.now() / 1000; // value should probably be inherited from parent transaction
      this.disableAnimation = false; // value should probably be inherited from parent transaction
      //this.layers = {}; // TODO: Cache presentation layers so you don't have to repeatedly calculate?
      this.automaticallyCommit = automaticallyCommit;
      this.settings = settings;
    }



    function ShoeContext() {
      this.targets = [];
      this.transactions = [];
      this.ticking = false;
      this.rendering = false;
      this.frame;

      this.mixins = [];
      this.modelLayers = []; // model layers // TODO: Cache presentation layers so you don't have to repeatedly calculate?
      this.unlayerize = function(modelLayer) {
      };
      this.layerize = function(modelLayer,delegate) {
        var mixin = this.mixinForModelLayer(modelLayer);
        if (!mixin) {
          mixin = {};
          Mixin(mixin,modelLayer,delegate);
          this.mixins.push(mixin);
          this.modelLayers.push(modelLayer);
        } else {
          console.log("mixin already exists for modelLayer delegate",mixin,modelLayer,delegate);
        }
        if (mixin) mixin.delegate = delegate;
      };

      this.addAnimation = function(modelLayer,animation,name) {
        var mixin = this.mixinForModelLayer(modelLayer);
        if (!mixin) { // maybe require layerize() rather than lazy create
          mixin = {};
          Mixin(mixin,modelLayer);
          this.mixins.push(mixin);
          this.modelLayers.push(modelLayer);
        }
        mixin.addAnimation(animation,name);
      };
      this.removeAnimation = function(object,name) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) mixin.removeAnimation(name);
      };
      this.removeAllAnimations = function(object) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) mixin.removeAllAnimations();
      };
      this.animationNamed = function(object,name) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) return mixin.animationNamed(name);
        return null;
      };
      this.animationKeys = function(object) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) return mixin.animationKeys();
        return [];
      };
      this.presentationLayer = function(object) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) return mixin.presentation;
        return object; // oh yeah?
      };
      this.registerAnimatableProperty = function(object,property,defaultValue) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) mixin.registerAnimatableProperty(property,defaultValue,object);
      };
    }

    ShoeContext.prototype = {
      createTransaction: function(settings,automaticallyCommit) {
        var transaction = new ShoeTransaction(settings,automaticallyCommit);
        var length = this.transactions.length;
        if (length) { // Time freezes in transactions. A time getter should return transaction time if within one.
          transaction.time = this.transactions[length-1].time;
        }
        this.transactions.push(transaction);
        if (automaticallyCommit) this.startTicking(); // Pyon bug fix !!! // Automatic transactions will otherwise not be closed if there is no animation or value set.
        return transaction;
      },
      currentTransaction: function() {
        var length = this.transactions.length;
        if (length) return this.transactions[length-1];
        return this.createTransaction({},true);
      },
      beginTransaction: function(settings) {
        this.createTransaction(settings,false);
      },
      commitTransaction: function() {
        var transaction = this.transactions.pop();
      },
      flushTransaction: function() { // TODO: prevent unterminated when called within render
        if (this.frame) cAF(this.frame); // Unsure if cancelling animation frame is needed.
        this.ticker(); // Probably should not commit existing transaction
      },
      disableAnimation: function(disable) {
        var transaction = this.currentTransaction();
        transaction.disableAnimation = disable;
        this.startTicking();
      },

      registerTarget: function(target) {
        this.startTicking();
        var index = this.targets.indexOf(target);
        if (index < 0) this.targets.push(target);
      },

      deregisterTarget: function(target) {
        var index = this.targets.indexOf(target);
        if (index > -1) this.targets.splice(index, 1);
      },
      startTicking: function() {
        if (!this.frame) this.frame = rAF(this.ticker.bind(this));
      },
      ticker: function() { // Need to manually cancel animation frame if calling directly.
        this.frame = undefined;
        var targets = this.targets.slice(0); // optimize me.
        targets.forEach( function(target) {
          if (!target.animations.length) this.deregisterTarget(target); // Deregister here to ensure one more tick after last animation has been removed
          var render = target.delegate.render;
          if (!isFunction(render)) render = target.render;
          if (isFunction(render)) {
            this.rendering = true;
            var presentation = target.presentation;
            var boundRender = render.bind(presentation); // "feckless"
            boundRender(presentation,target.modelLayer); // "feckless"
            //render();
            this.rendering = false;
          }
        }.bind(this));
        var length = this.transactions.length;
        if (length) {
          var transaction = this.transactions[length-1];
          if (transaction.automaticallyCommit) this.commitTransaction();
        }
        if (this.targets.length) this.startTicking();
      }
    }

    ShoeContext.prototype.mixinForModelLayer = function(object) { // Pretend this uses a weak map
      var index = this.modelLayers.indexOf(object);
      if (index > -1) return this.mixins[index];
    }

    var shoeContext = new ShoeContext();

    var animationFromDescription = function(description) {
        var animation;
        if (description && description instanceof ShoeValue) {
          animation = description.copy();
        } else if (description && isFunction(description)) {
          animation = new description(); // TODO: Need transaction duration if animation not disabled !!!
        } else if (description && typeof description === "object") {
          if (isFunction(description.type)) animation = new description.type(description);
          else animation = new ShoeNumber(description);
          if (!animation instanceof ShoeValue) animation = null;
        } else if (isNumber(description)) animation = new ShoeNumber({duration:description});
        return animation;
      };

    function Mixin(receiver,modelLayer,delegate) { // should be renamed: controller, layer, delegate // maybe reordered: layer, controller, delegate
      var modelDict = {};
      var registeredProperties = [];
      var allAnimations = [];
      var namedAnimations = {};
      var defaultAnimations = {};
      //var animationCount = 0; // need to implement auto increment key
      var shouldSortAnimations = false;
      var animationNumber = 0; // order added

      if (modelLayer === null || modelLayer === undefined) modelLayer = receiver;
      receiver.modelLayer = modelLayer;

      if (delegate === null || delegate === undefined) delegate = modelLayer;
      receiver.delegate = delegate;

      var implicitAnimation = function(property,value) {
        var description;
        if (isFunction(delegate.animationForKey)) description = delegate.animationForKey(property,value,receiver.modelLayer);
        var animation = animationFromDescription(description);
        if (!animation) animation = animationFromDescription(defaultAnimations[property]);
        return animation;
      };

      var valueForKey = function(property) {
        if (shoeContext.rendering) return receiver.presentation[property]; // FIXME: automatic presentationLayer causes unterminated. Was used with virtual-dom
        return modelDict[property];
      };

      var setValueForKey = function(value,property) {
        if (value === modelDict[property]) return; // New in Pyon! No animation if no change. This filters out repeat setting of unchanging model values while animating. Function props are always not equal
        var animation;
        var transaction = shoeContext.currentTransaction(); // Pyon bug! This transaction might not get closed.
        if (!transaction.disableAnimation) {
          animation = implicitAnimation(property,value);
          if (animation) {
            if (animation.property === null || animation.property === undefined) animation.property = property;
            if (animation.from === null || animation.from === undefined) {
              if (animation.blend === "absolute") animation.from = receiver.presentation[property]; // use presentation layer
              else animation.from = modelDict[property];
            }
            if (animation.to === null || animation.to === undefined) animation.to = value;
            receiver.addAnimation(animation); // this will copy a second time.
          }
        }
        modelDict[property] = value;

        if (!animation) { // need to manually call render on property value change without animation. transactions.
          var render = delegate.render;
          if (!isFunction(render)) render = receiver.render;
          if (isFunction(render)) {
            shoeContext.rendering = true;
            var presentation = receiver.presentation;
            var boundRender = render.bind(presentation);
            boundRender(presentation,receiver.modelLayer);
            shoeContext.rendering = false;
          }
        }
      };

      receiver.registerAnimatableProperty = function(property, defaultValue) { // Needed to trigger implicit animation.
        if (registeredProperties.indexOf(property) === -1) registeredProperties.push(property);

        var descriptor = Object.getOwnPropertyDescriptor(modelLayer, property);
        if (descriptor && descriptor.configurable === false) { // need automatic registration
          // Fail silently so you can set default animation by registering it again
          //return;
        }
        var defaultAnimation = animationFromDescription(defaultValue);

        if (defaultAnimation) defaultAnimations[property] = defaultAnimation; // maybe set to defaultValue not defaultAnimation
        else if (defaultAnimations[property]) delete defaultAnimations[property]; // property is still animatable

        if (!descriptor || descriptor.configurable === true) {
          modelDict[property] = modelLayer[property];
          Object.defineProperty(modelLayer, property, { // ACCESSORS
            get: function() {
              return valueForKey(property);
            },
            set: function(value) {
              setValueForKey(value,property);
            },
            enumerable: true,
            configurable: true // temporary, to resolve unterminated
          });
        }
      }

      Object.defineProperty(receiver, "animations", {
        get: function() {
          return allAnimations.map(function (animation) {
            return animation.copy(); // Lots of copying. Potential optimization. Instead maybe freeze properties.
          });
        },
        enumerable: false,
        configurable: false
      });
      Object.defineProperty(receiver, "animationKeys", {
        get: function() {
          return Object.keys(namedAnimations);
        },
        enumerable: false
      });

      var debugAccessCount = 0;
      var presentationKey = "presentation"; // Rename "presentationLayer"?
      var presentationComposite = function() {
        //var presentationLayer = {};
        var presentationLayer = Object.create(receiver.modelLayer); // Until we have ES6 Proxy, have to use Object.create
        var compositor = Object.keys(modelDict).reduce(function(a, b) { a[b] = modelDict[b]; return a;}, {});
        
        Object.keys(compositor).forEach( function(property) {
          var defaultAnimation = defaultAnimations[property];
          if (defaultAnimation instanceof ShoeValue && defaultAnimation.blend === "zero") compositor[property] = defaultAnimation.zero(); // blend mode zero has conceptual difficulties. Animations affect layers in ways beyond what an animation should. zero presentation is more of a layer property, not animation. Default animation is the only thing that can be used. Can't do this from animationForKey
        });
        var finishedAnimations = [];

        Object.defineProperty(presentationLayer, presentationKey, { // FIX ME // value should be the presentation layer itself
          value: presentationLayer,
          enumerable: false,
          configurable: false
        });

        if (shouldSortAnimations) {
          allAnimations.sort( function(a,b) {
            var A = a.index, B = b.index;
            if (A === null || A === undefined) A = 0;
            if (B === null || B === undefined) B = 0;
            var result = A - B;
            if (!result) result = a.startTime - b.startTime;
            if (!result) result = a.number - b.number; // animation number is needed because sort is not guaranteed to be stable
            return result;
          });
          shouldSortAnimations = false;
        }

        if (allAnimations.length) { // Pyon bug fix! Do not create a transaction if there are no animations else the transaction will not be automatically closed.
          var transaction = shoeContext.currentTransaction();
          var now = transaction.time;

          allAnimations.forEach( function(animation) {
            animation.composite(compositor,now);
            if (animation.finished > 1) throw new Error("Animation finishing twice is not possible");
            if (animation.finished > 0) finishedAnimations.push(animation);
          });
        }
        
        var compositorKeys = Object.keys(compositor);
        compositorKeys.forEach( function(property) {
          //presentationLayer[property] = compositor[property]; // fail, caused unterminated valueForKey when getting presentationLayer
          Object.defineProperty(presentationLayer, property, {value:compositor[property], enumerable:true}); // pass. Overwrite the setters.
        });
        
        registeredProperties.forEach( function(property) {
          if (compositorKeys.indexOf(property) === -1) {
            var value = modelDict[property];
            var defaultAnimation = defaultAnimations[property]; // Blend mode zero suffers from conceptual difficulties. don't want to ask for animationForKey again. need to determine presentation value
            if (defaultAnimation instanceof ShoeValue && defaultAnimation.blend === "zero") value = defaultAnimation.zero();
            presentationLayer[property] = value;
          }
        }.bind(receiver));

        finishedAnimations.forEach( function(animation) {
          if (isFunction(animation.completion)) animation.completion();
        });

        return presentationLayer;
      }

      Object.defineProperty(receiver, presentationKey, { // COMPOSITING. Have separate compositor object?
        get: function() { // need transactions and cache presentation layer
          return presentationComposite();
        },
        enumerable: false,
        configurable: false
      });

      /*
      receiver.needsDisplay = function() {
        // This should be used instead of directly calling render
      }
      */
      var removeAnimationInstance = function(animation) {
        var index = allAnimations.indexOf(animation);
        if (index > -1) allAnimations.splice(index,1); // do not deregister yet, must ensure one more tick
      }

      var removalCallback = function(animation,key) {
        if (key !== null && key !== undefined) receiver.removeAnimation(key);
        else removeAnimationInstance(animation);
      }

      receiver.addAnimation = function(animation,name) { // should be able to pass a description if type is registered
        if (!(animation instanceof ShoeValue) && animation !== null && typeof animation === "object") {
          animation = animationFromDescription(animation);
        }
        
        if (!animation instanceof ShoeValue) throw new Error("Animations must be a subclass of Shoe.ValueType.");
        if (!allAnimations.length) shoeContext.registerTarget(receiver);
        var copy = animation.copy();
        copy.number = animationNumber++;
        allAnimations.push(copy);
        if (name !== null && name !== undefined) {
          var previous = namedAnimations[name];
          if (previous) removeAnimationInstance(previous); // after pushing to allAnimations, so context doesn't stop ticking
          namedAnimations[name] = copy;
        }
        shouldSortAnimations = true;
        copy.runAnimation(receiver, name, removalCallback);
      }

      receiver.removeAnimation = function(name) {
        var animation = namedAnimations[name];
        removeAnimationInstance(animation);
        delete namedAnimations[name];
      }

      receiver.removeAllAnimations = function() {
        allAnimations = [];
        namedAnimations = {};
      }

      receiver.animationNamed = function(name) {
        var animation = namedAnimations[name];
        if (animation) return animation.copy();
        return null;
      }
    }



    function ShoeLayer() { // Meant to be subclassed to provide implicit animation and clear distinction between model/presentation values
      Mixin(this);
    }
    ShoeLayer.prototype = {};
    ShoeLayer.prototype.constructor = ShoeLayer;
    ShoeLayer.prototype.animationForKey = function(key,value,target) {
      return null;
    };



    function GraphicsLayer() {
      // This should more closely resemble CALayer, ShoeLayer just focuses on animations and triggering them
      // This should have renderInContext: instead of render:
      // Provide frame and bounds, allow sublayers.
      // apply transforms.
      // all drawing into top level layer backed object that holds canvas.
      // Only top layer has a canvas element
    }



    function ShoeAnimation(settings) { // The base animation class
      if (this instanceof ShoeValue === false) {
        throw new Error("ShoeValue is a constructor, not a function. Do not call it directly.");
      }
      if (this.constructor === ShoeValue) {
        throw new Error("Shoe.ValueType is an abstract base class.");
      }
      this.settings = settings;
      this.property; // string, property name
      this.from; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
      this.to; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
      this.onend; // NOT FINISHED. callback function, fires regardless of fillMode. Should rename. Should also implement didStart, maybe didTick, etc.
      this.duration = 0.0; // float. In seconds. Need to validate/ensure >= 0.
      this.easing; // NOT FINISHED. currently callback function only, need cubic bezier and presets. Defaults to linear
      this.speed = 1.0; // float. RECONSIDER. Pausing currently not possible like in Core Animation. Layers have speed, beginTime, timeOffset!
      this.iterations = 1; // float >= 0.
      this.autoreverse; // boolean. When iterations > 1. Easing also reversed. Maybe should be named "autoreverses", maybe should be camelCased
      this.fillMode; // string. Defaults to "none". NOT FINISHED. "forwards" and "backwards" are "both". maybe should be named "fill". maybe should just be a boolean
      this.index = 0; // float. Custom compositing order.
      this.delay = 0; // float. In seconds.
      this.blend = "relative"; // also "absolute" or "zero" // Default should be "absolute" if explicit
      this.additive = true;
      this.sort;
      this.finished = 0;//false;
      this.startTime; // float
      this.delta;

      if (settings) Object.keys(settings).forEach( function(key) {
        this[key] = settings[key];
      }.bind(this));

      this.composite = function(onto,now) {

        if (this.startTime === null || this.startTime === undefined) return this.zero();
        var elapsed = Math.max(0, now - (this.startTime + this.delay));
        var speed = this.speed; // might make speed a property of layer, not animation, might not because no sublayers / layer hierarcy yet. Part of GraphicsLayer.
        var iterationProgress = 1;
        var combinedProgress = 1;
        var iterationDuration = this.duration;
        var combinedDuration = iterationDuration * this.iterations;
        if (combinedDuration) {
          iterationProgress = elapsed * speed / iterationDuration;
          combinedProgress = elapsed * speed / combinedDuration;
        }
        if (combinedProgress >= 1) {
          iterationProgress = 1;
          this.finished++;// = true;
        }
        var inReverse = 0; // falsy
        if (!this.finished) {
          if (this.autoreverse === true) inReverse = Math.floor(iterationProgress) % 2;
          iterationProgress = iterationProgress % 1; // modulus for iterations
        }
        if (inReverse) iterationProgress = 1-iterationProgress; // easing is also reversed
        if (isFunction(this.easing)) iterationProgress = this.easing(iterationProgress);
        else if (this.easing !== "linear") iterationProgress = 0.5-(Math.cos(iterationProgress * Math.PI) / 2);

        var value = (this.blend === "absolute") ? this.interpolate(this.from,this.to,iterationProgress) : this.interpolate(this.delta,this.zero(),iterationProgress);
        var property = this.property;

        if (this.additive) onto[property] = this.add(onto[property],value);
        else onto[property] = value;
      }

      this.runAnimation = function(layer,key,removalCallback) {
        if (!this.duration) this.duration = 0.0; // need better validation. Currently is split across constructor, setter, and here
        if (this.speed === null || this.speed === undefined) this.speed = 1; // need better validation
        if (this.iterations === null || this.iterations === undefined) this.iterations = 1; // negative values have no effect
        if (this.blend !== "absolute") this.delta = this.subtract(this.from,this.to);
        this.completion = function() { // COMPLETION
          if (!this.fillMode || this.fillMode === "none") {
            removalCallback(this,key);
          }
          if (isFunction(this.onend)) this.onend();
          this.completion = null; // lazy way to keep compositor from calling this twice, during fill phase
        }.bind(this);
        if (this.startTime === null || this.startTime === undefined) this.startTime = shoeContext.currentTransaction().time;
      }
    }


    function ShoeValue(settings) { // The base animation type
      if (this instanceof ShoeValue === false) {
        throw new Error("ShoeValue is a constructor, not a function. Do not call it directly.");
      }
      if (this.constructor === ShoeValue) {
        throw new Error("Shoe.ValueType is an abstract base class.");
      }
      this.settings = settings;
      this.property; // string, property name
      this.from; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
      this.to; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
      this.onend; // NOT FINISHED. callback function, fires regardless of fillMode. Should rename. Should also implement didStart, maybe didTick, etc.
      this.duration = 0.0; // float. In seconds. Need to validate/ensure >= 0.
      this.easing; // NOT FINISHED. currently callback function only, need cubic bezier and presets. Defaults to linear
      this.speed = 1.0; // float. RECONSIDER. Pausing currently not possible like in Core Animation. Layers have speed, beginTime, timeOffset!
      this.iterations = 1; // float >= 0.
      this.autoreverse; // boolean. When iterations > 1. Easing also reversed. Maybe should be named "autoreverses", maybe should be camelCased
      this.fillMode; // string. Defaults to "none". NOT FINISHED. "forwards" and "backwards" are "both". maybe should be named "fill". maybe should just be a boolean
      this.index = 0; // float. Custom compositing order.
      this.delay = 0; // float. In seconds.
      this.blend = "relative"; // also "absolute" or "zero" // Default should be "absolute" if explicit
      this.additive = true;
      this.sort;
      this.finished = 0;//false;
      this.startTime; // float
      this.delta;

      if (settings) Object.keys(settings).forEach( function(key) {
        this[key] = settings[key];
      }.bind(this));

      this.composite = function(onto,now) {

        if (this.startTime === null || this.startTime === undefined) return this.zero();
        var elapsed = Math.max(0, now - (this.startTime + this.delay));
        var speed = this.speed; // might make speed a property of layer, not animation, might not because no sublayers / layer hierarcy yet. Part of GraphicsLayer.
        var iterationProgress = 1;
        var combinedProgress = 1;
        var iterationDuration = this.duration;
        var combinedDuration = iterationDuration * this.iterations;
        if (combinedDuration) {
          iterationProgress = elapsed * speed / iterationDuration;
          combinedProgress = elapsed * speed / combinedDuration;
        }
        if (combinedProgress >= 1) {
          iterationProgress = 1;
          this.finished++;// = true;
        }
        var inReverse = 0; // falsy
        if (!this.finished) {
          if (this.autoreverse === true) inReverse = Math.floor(iterationProgress) % 2;
          iterationProgress = iterationProgress % 1; // modulus for iterations
        }
        if (inReverse) iterationProgress = 1-iterationProgress; // easing is also reversed
        if (isFunction(this.easing)) iterationProgress = this.easing(iterationProgress);
        else if (this.easing !== "linear") iterationProgress = 0.5-(Math.cos(iterationProgress * Math.PI) / 2);

        var value = (this.blend === "absolute") ? this.interpolate(this.from,this.to,iterationProgress) : this.interpolate(this.delta,this.zero(),iterationProgress);
        var property = this.property;

        if (this.additive) onto[property] = this.add(onto[property],value);
        else onto[property] = value;
      }

      this.runAnimation = function(layer,key,removalCallback) {
        if (!this.duration) this.duration = 0.0; // need better validation. Currently is split across constructor, setter, and here
        if (this.speed === null || this.speed === undefined) this.speed = 1; // need better validation
        if (this.iterations === null || this.iterations === undefined) this.iterations = 1; // negative values have no effect
        if (this.blend !== "absolute") this.delta = this.subtract(this.from,this.to);
        this.completion = function() { // COMPLETION
          if (!this.fillMode || this.fillMode === "none") {
            removalCallback(this,key);
          }
          if (isFunction(this.onend)) this.onend();
          this.completion = null; // lazy way to keep compositor from calling this twice, during fill phase
        }.bind(this);
        if (this.startTime === null || this.startTime === undefined) this.startTime = shoeContext.currentTransaction().time;
      }
    }
    ShoeValue.prototype = {
      copy: function() { // optimize me // "Not Optimized. Reference to a variable that requires dynamic lookup"
        //return Object.create(this);
        var constructor = this.constructor;
        var copy = new constructor(this.settings);
        var keys = Object.getOwnPropertyNames(this);
        var length = keys.length;
        for (var i = 0; i < length; i++) {
          Object.defineProperty(copy, keys[i], Object.getOwnPropertyDescriptor(this, keys[i]));
        }
        return copy;
      },
      validate: function(value) {
        return true;
      },
      zero: function() {
        throw new Error("Shoe.ValueType subclasses must implement function: zero()");
      },
      add: function() {
        throw new Error("Shoe.ValueType subclasses must implement function: add(a,b)");
      },
      subtract: function() {
        throw new Error("Shoe.ValueType subclasses must implement function: subtract(a,b) in the form subtract b from a");
      },
      interpolate: function() {
        throw new Error("Shoe.ValueType subclasses must implement function: interpolate(a,b,progress)");
      }
    }



    function ShoeNumber(settings) {
      ShoeValue.call(this,settings);
    }
    ShoeNumber.prototype = Object.create(ShoeValue.prototype);
    ShoeNumber.prototype.constructor = ShoeNumber;
    ShoeNumber.prototype.zero = function() {
      return 0;
    };
    ShoeNumber.prototype.add = function(a,b) {
      return a + b;
    };
    ShoeNumber.prototype.subtract = function(a,b) { // subtract b from a
      return a - b;
    };
    ShoeNumber.prototype.interpolate = function(a,b,progress) {
      return a + (b-a) * progress;
    };



    function ShoeScale(settings) {
      ShoeValue.call(this,settings);
    }
    ShoeScale.prototype = Object.create(ShoeValue.prototype);
    ShoeScale.prototype.constructor = ShoeScale;
    ShoeScale.prototype.zero = function() {
      return 1;
    };
    ShoeScale.prototype.add = function(a,b) {
      return a * b;
    };
    ShoeScale.prototype.subtract = function(a,b) { // subtract b from a
      if (b === 0) return 0;
      return a/b;
    };
    ShoeScale.prototype.interpolate = function(a,b,progress) {
      return a + (b-a) * progress;
    };



    function ShoeArray(type,length,settings) {
      Shoe.ValueType.call(this,settings);
      this.type = type;
      if (isFunction(type)) this.type = new type(settings);
      this.length = length;
    }
    ShoeArray.prototype = Object.create(ShoeValue.prototype);
    ShoeArray.prototype.constructor = ShoeArray;
    ShoeArray.prototype.zero = function() {
      var array = [];
      var i = this.length;
      while (i--) array.push(this.type.zero());
      return array;
    };
    ShoeArray.prototype.add = function(a,b) {
      var array = [];
      for (var i = 0; i < this.length; i++) {
        array.push(this.type.add(a[i],b[i]));
      }
      return array;
    };
    ShoeArray.prototype.subtract = function(a,b) { // subtract b from a
      var array = [];
      for (var i = 0; i < this.length; i++) {
        array.push(this.type.subtract(a[i],b[i]));
      }
      return array;
    };
    ShoeArray.prototype.interpolate = function(a,b,progress) {
      var array = [];
      for (var i = 0; i < this.length; i++) {
        array.push(this.type.interpolate(a[i],b[i],progress));
      }
      return array;
    };



    function ShoeSet(settings) {
      ShoeValue.call(this,settings);
    }
    ShoeSet.prototype = Object.create(ShoeValue.prototype);
    ShoeSet.prototype.constructor = ShoeSet;
    ShoeSet.prototype.zero = function() {
      return [];
    };
    ShoeSet.prototype.add = function(a,b) {
      if (!Array.isArray(a) && !Array.isArray(b)) return [];
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      if (this.sort && isFunction(this.sort)) {
        var sortedA = a.slice(0).sort(this.sort);
        var sortedB = b.slice(0).sort(this.sort);
        var aLength = sortedA.length;
        if (!aLength) return sortedB;
        var bLength = sortedB.length;
        var aIndex = 0;
        var bIndex = 0;
        var added = [];
        while (bIndex < bLength) {
          var itemA = sortedA[aIndex];
          var itemB = sortedB[bIndex];
          var sorted = this.sort(itemA,itemB);
          if (sorted > 0) { // b first
            sortedA.splice(aIndex,0,itemB);
            aIndex++;
            aLength++;
            bIndex++;
          } else if (sorted < 0) { // a first
            if (aIndex < aLength - 1) aIndex++;
            else {
              aIndex++;
              aLength++;
              bIndex++;
              sortedA.splice(aIndex,0,itemB);
            }
          } else { // same
            if (aIndex < aLength - 1) aIndex++;
            bIndex++;
          }
        }
        return sortedA;
      }
      var array = a.slice(0);
      var i = b.length;
      while (i--) {
        if (a.indexOf(b[i]) < 0) array.push(b[i]);
      }
      if (this.sort === true) array.sort(); // Array.sort default is by unicode codepoint
      //else if (this.sort && isFunction(this.sort)) array.sort(this.sort);
      return array;
    };
    ShoeSet.prototype.subtract = function(a,b) { // remove b from a
      if (!Array.isArray(a) && !Array.isArray(b)) return [];
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      if (this.sort && isFunction(this.sort)) {
        var sortedA = a.slice(0).sort(this.sort);
        var sortedB = b.slice(0).sort(this.sort);
        var aLength = sortedA.length;
        var bLength = sortedB.length;
        if (!aLength) return sortedA;
        var aIndex = 0;
        var bIndex = 0;
        var added = [];
        while (bIndex < bLength) {
          var itemA = sortedA[aIndex];
          var itemB = sortedB[bIndex];
          var sorted = this.sort(itemA,itemB);
          if (sorted > 0) { // b first
            bIndex++;
          } else if (sorted < 0) { // a first
            aIndex++;
            if (aIndex == aLength) break;
          } else { // same
            sortedA.splice(aIndex,1);
            aLength--;
            bIndex++;
            if (aIndex == aLength) break;
          }
        }
        return sortedA;
      }
      var array = a.slice(0);
      var i = b.length;
      while (i--) {
        var loc = array.indexOf(b[i]);
        if (loc > -1) array.splice(loc,1);
      }
      return array;
    };
    ShoeSet.prototype.interpolate = function(a,b,progress) {
      if (progress >= 1) return b;
      return a;
    };


    return {
      Layer: ShoeLayer, // The basic layer class, meant to be subclassed
      ValueType: ShoeValue, // Abstract animation base class
      NumberType: ShoeNumber, // For animating numbers
      ScaleType: ShoeScale, // For animating transform scale
      ArrayType: ShoeArray, // For animating arrays of other value types
      SetType: ShoeSet, // Discrete object collection changes
      beginTransaction: shoeContext.beginTransaction.bind(shoeContext),
      commitTransaction: shoeContext.commitTransaction.bind(shoeContext),
      flushTransaction: shoeContext.flushTransaction.bind(shoeContext),
      currentTransaction: shoeContext.currentTransaction.bind(shoeContext),
      disableAnimation: shoeContext.disableAnimation.bind(shoeContext),

      addAnimation: shoeContext.addAnimation.bind(shoeContext),
      removeAnimation: shoeContext.removeAnimation.bind(shoeContext),
      removeAllAnimations: shoeContext.removeAllAnimations.bind(shoeContext),
      animationNamed: shoeContext.animationNamed.bind(shoeContext),
      animationKeys: shoeContext.animationKeys.bind(shoeContext),
      presentationLayer: shoeContext.presentationLayer.bind(shoeContext),
      registerAnimatableProperty: shoeContext.registerAnimatableProperty.bind(shoeContext),

      layerize: shoeContext.layerize.bind(shoeContext),
      mixin: Mixin, // To mixin layer functionality in objects that are not ShoeLayer subclasses.
    }
  })();

  
  Pyon.noConflict = function() {
    root.Pyon = previousPyon;
    return Pyon;
  }
  if (typeof exports !== "undefined") { // http://www.richardrodger.com/2013/09/27/how-to-make-simple-node-js-modules-work-in-the-browser/#.VpuIsTZh2Rs
    if (typeof module !== "undefined" && module.exports) exports = module.exports = Pyon;
    exports.Pyon = Pyon;
  } else root.Pyon = Pyon;
  
  //if (typeof module !== "undefined" && typeof module.exports !== "undefined") module.exports = Pyon; // http://www.matteoagosti.com/blog/2013/02/24/writing-javascript-modules-for-both-browser-and-node/
  //else window.Pyon = Pyon;
}).call(this);
