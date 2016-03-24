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
(function() {

  var root = this;
  var previousPyon = root.Pyon;
  var Pyon = root.Pyon = (function() {

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

    function exists(w) {
      return typeof w !== "undefined" && w !== null;
    }

    function isFunction(w) {
      return w && {}.toString.call(w) === "[object Function]";
    }

    function isNumber(w) {
      return !isNaN(parseFloat(w)) && isFinite(w); // I want infinity for repeat count. Probably not duration
    }

    function PyonTransaction(settings,automaticallyCommit) {
      this.time = performance.now() / 1000; // value should probably be inherited from parent transaction
      this.disableAnimation = false; // value should probably be inherited from parent transaction
      this._automaticallyCommit = automaticallyCommit;
      this.settings = settings;
    }



    function PyonContext() {
      this.targets = [];
      this.transactions = [];
      this.ticking = false;
      this.rendering = false;
      this.frame;

      this.mixins = [];
      this.modelLayers = []; // model layers // TODO: Cache presentation layers so you don't have to repeatedly calculate?
      this.renderLayers = []; // cachedPresentationLayer
      this.unlayerize = function(modelLayer) {
      };
      this.layerize = function(modelLayer,delegate) {
        var mixin = this.mixinForModelLayer(modelLayer);
        if (!mixin) {
          mixin = {};
          Pyonify(mixin,modelLayer,delegate);
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
          Pyonify(mixin,modelLayer);
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
        if (mixin) return mixin.presentationLayer;
        return object; // oh yeah?
      };
      this.registerAnimatableProperty = function(object,property,defaultValue) {
        var mixin = this.mixinForModelLayer(object);
        if (mixin) mixin.registerAnimatableProperty(property,defaultValue,object);
      };
    }

    PyonContext.prototype = {
      createTransaction: function(settings,automaticallyCommit) {
        var transaction = new PyonTransaction(settings,automaticallyCommit);
        var length = this.transactions.length;
        if (length) { // Time freezes in transactions. A time getter should return transaction time if within one.
          transaction.time = this.transactions[length-1].time;
        }
        this.transactions.push(transaction);
        if (automaticallyCommit) this.startTicking(); // Pyon bug fix // Automatic transactions will otherwise not be closed if there is no animation or value set.
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
        if (index < 0) {
          this.targets.push(target);
          this.renderLayers.push(null); // cachedPresentationLayer
        }
      },

      deregisterTarget: function(target) {
        var index = this.targets.indexOf(target);
        if (index > -1) {
          this.targets.splice(index, 1);
          this.renderLayers.splice(index, 1); // cachedPresentationLayer
        }
      },
      startTicking: function() {
        if (!this.frame) this.frame = rAF(this.ticker.bind(this));
      },
      ticker: function() { // Need to manually cancel animation frame if calling directly.
        this.frame = undefined;
        var targets = this.targets; // experimental optimization, traverse backwards so you can remove. This has caused problems for me before, but I don't think I was traversing backwards.
        var i = targets.length;
        
        while (i--) {
          var target = targets[i];
          if (!target.animations.length) this.deregisterTarget(target); // Deregister here to ensure one more tick after last animation has been removed
          
          var render = target.delegate.render;
          if (!isFunction(render)) render = target.render;
          if (isFunction(render)) {
            this.rendering = true;
            var presentationLayer = target.presentationLayer;
            if (this.renderLayers[i] !== presentationLayer) { // This is a poor way to suppress unnecessary renders
              this.renderLayers[i] = presentationLayer; // cachedPresentationLayer
              var boundRender = render.bind(presentationLayer);
              //boundRender(presentationLayer,target.modelLayer);
              boundRender();
            }
            //render();
            this.rendering = false;
          }
        }
        
        var length = this.transactions.length;
        if (length) {
          var transaction = this.transactions[length-1];
          if (transaction._automaticallyCommit) this.commitTransaction();
        }
        
        if (this.targets.length) this.startTicking();
      }
    }

    PyonContext.prototype.mixinForModelLayer = function(object) { // Pretend this uses a weak map
      var index = this.modelLayers.indexOf(object);
      if (index > -1) return this.mixins[index];
    }

    var pyonContext = new PyonContext();

    var animationFromDescription = function(description) {
      var animation;
      if (description && description instanceof PyonAnimation) {
        animation = description.copy();
      } else if (description && typeof description === "object") {
        animation = new PyonAnimation(description);
      } else if (isNumber(description)) animation = new PyonAnimation({duration:description});
      return animation;
    };

    function Pyonify(receiver, modelInstance, delegate) { // should be renamed: controller, layer, delegate // maybe reordered: layer, controller, delegate
      var modelDict = {}; // TODO: Unify modelDict, modelInstance, modelLayer.
      var registeredProperties = [];
      var allAnimations = [];
      var namedAnimations = {};
      var defaultAnimations = {};
      //var animationCount = 0; // need to implement auto increment key
      var shouldSortAnimations = false;
      var animationNumber = 0; // order added
      
      var cachedPresentationLayer = null;
      var cachedPresentationTime = -1;

      if (modelInstance === null || modelInstance === undefined) modelInstance = receiver;

      if (delegate === null || delegate === undefined) delegate = modelInstance;
      receiver.delegate = delegate;

      var implicitAnimation = function(property,value) {
        var description;
        if (isFunction(delegate.animationForKey)) description = delegate.animationForKey(property,value);
        var animation = animationFromDescription(description);
        if (!animation) animation = animationFromDescription(defaultAnimations[property]);
        return animation;
      };

      var valueForKey = function(property) {
        //if (pyonContext.rendering) return receiver.presentationLayer[property]; // FIXME: automatic presentationLayer causes unterminated. Was used with virtual-dom
        if (pyonContext.rendering && cachedPresentationLayer) return cachedPresentationLayer[property];
        return modelDict[property];
      };

      var setValueForKey = function(value,property) {
        // No animation if no change is fine, but I have to prevent pyon-react presentation from calling this.
        if (value === modelDict[property]) return; // New in Pyon! No animation if no change. This filters out repeat setting of unchanging model values while animating. Function props are always not equal (if you're not careful)
        var animation;
        var transaction = pyonContext.currentTransaction(); // Pyon bug! This transaction might not get closed.
        if (!transaction.disableAnimation) {
          animation = implicitAnimation(property,value);
          if (animation) {
            if (animation.property === null || typeof animation.property === "undefined") animation.property = property;
            if (animation.from === null || typeof animation.from === "undefined") {
              if (animation.blend === "absolute") animation.from = receiver.presentationLayer[property]; // use presentation layer
              else animation.from = modelDict[property];
            }
            if (animation.to === null || typeof animation.to === "undefined") animation.to = value;
            receiver.addAnimation(animation); // this will copy a second time.
          }
        }
        modelDict[property] = value;
        cachedPresentationLayer = null;

        if (!animation) receiver.needsDisplay();
      };
      
      var registerAnimatableProperty = function(property, defaultValue) { // Needed to trigger implicit animation.
        if (registeredProperties.indexOf(property) === -1) registeredProperties.push(property);
        var descriptor = Object.getOwnPropertyDescriptor(modelInstance, property);
        //if (descriptor && descriptor.configurable === false) { // need automatic registration
          // Fail silently so you can set default animation by registering it again
          //return;
        //}
        var defaultAnimation = animationFromDescription(defaultValue);
        
        if (defaultAnimation) defaultAnimations[property] = defaultAnimation; // maybe set to defaultValue not defaultAnimation
        else if (defaultAnimations[property]) delete defaultAnimations[property]; // property is still animatable
        
        if (!descriptor || descriptor.configurable === true) {
          modelDict[property] = modelInstance[property];
          Object.defineProperty(modelInstance, property, { // ACCESSORS
            get: function() {
              return valueForKey(property);
            },
            set: function(value) {
              setValueForKey(value,property);
            },
            enumerable: true,
            configurable: true
          });
        }
      }
      receiver.registerAnimatableProperty = registerAnimatableProperty;
      if (delegate) delegate.registerAnimatableProperty = registerAnimatableProperty;
      
      Object.defineProperty(receiver, "animations", {
        get: function() {
          return allAnimations.map(function (animation) {
            return animation.copy(); // Lots of copying. Potential optimization. Instead maybe freeze properties.
          });
        },
        enumerable: false,
        configurable: false
      });
      
      Object.defineProperty(receiver, "animationNames", {
        get: function() {
          return Object.keys(namedAnimations);
        },
        enumerable: false,
        configurable: false
      });
      
      Object.defineProperty(receiver, "modelLayer", {
        get: function() {
          var modelLayer = Object.create(modelInstance); // modelInstance has defined properties. Must redefine.
          registeredProperties.forEach( function(item,index) {
            Object.defineProperty(modelLayer, item, {
              value: modelDict[item],
              enumerable: true,
              configurable: false
            });
          }.bind(this));
          return modelLayer;
        },
        enumerable: true,
        configurable: false
      });
      
      var debugAccessCount = 0;
      var presentationComposite = function() { // TODO: optimize me // return modelLayer if there are no animations
        //var presentationLayer = {}; // This does not work because an implementation's render function would otherwise not get non-animated properties like this.element
        var presentationLayer = Object.create(modelInstance); // Until we have ES6 Proxy, have to use Object.create. // You need this so render has non animated properties like this.element // modelInstance becomes prototype
        var compositor = Object.keys(modelDict).reduce(function(a, b) { a[b] = modelDict[b]; return a;}, {});
        
        Object.keys(compositor).forEach( function(property) {
          var defaultAnimation = defaultAnimations[property];
          if (defaultAnimation instanceof PyonAnimation && defaultAnimation.blend === "zero") compositor[property] = defaultAnimation.type.zero(); // deprecate me // blend mode zero has conceptual difficulties. Animations affect layers in ways beyond what an animation should. zero presentation is more of a layer property, not animation. Default animation is the only thing that can be used. Can't do this from animationForKey. Also zero needs an argument
        });
        var finishedAnimations = [];

        Object.defineProperty(presentationLayer, "presentationLayer", {
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
        
        var progressChanged = false;
        if (allAnimations.length) { // Do not create a transaction if there are no animations else the transaction will not be automatically closed.
          var transaction = pyonContext.currentTransaction();
          var now = transaction.time;

          allAnimations.forEach( function(animation) {
            progressChanged = animation.composite(compositor,now) || progressChanged;
            if (animation.finished > 1) throw new Error("Animation finishing twice is not possible");
            if (animation.finished > 0) finishedAnimations.push(animation);
          });
        }
        
        if (!progressChanged && allAnimations.length && !finishedAnimations.length) {
        //if (!progressChanged && !finishedAnimations.length) {
          if (!cachedPresentationLayer) cachedPresentationLayer = presentationLayer;
          else return cachedPresentationLayer; // experimental optimization
        }
        
        var compositorKeys = Object.keys(compositor);
        compositorKeys.forEach( function(property) { // TODO: Should not defineProperty. Use regular value and freeze object.
          //presentationLayer[property] = compositor[property]; // FIXME: fail, caused unterminated valueForKey when getting presentationLayer
          Object.defineProperty(presentationLayer, property, {value:compositor[property], enumerable:true}); // pass. Overwrite the setters.
        });
        
        /*
        registeredProperties.forEach( function(property) { // TODO: Registered properties are required to trigger implicit. Registered but undefined properties should not be added to presentationLayer unless there is an animation.
          if (compositorKeys.indexOf(property) === -1) {
            var value = modelDict[property];
            var defaultAnimation = defaultAnimations[property]; // Blend mode zero suffers from conceptual difficulties. don't want to ask for animationForKey again. need to determine presentation value
            if (defaultAnimation instanceof PyonAnimation && defaultAnimation.blend === "zero") value = defaultAnimation.type.zero(); // deprecate me
            presentationLayer[property] = value;
          }
        }.bind(receiver));
        */

        finishedAnimations.forEach( function(animation) {
          if (isFunction(animation.completion)) animation.completion();
        });
        cachedPresentationLayer = presentationLayer;
        
        return presentationLayer;
      }
      
      Object.defineProperty(receiver, "presentationLayer", {
        get: function() {
          return presentationComposite(); // COMPOSITING. Have separate compositor object?
        },
        enumerable: false,
        configurable: false
      });
      
      if (receiver !== delegate) {
        Object.defineProperty(delegate, "presentationLayer", { // DUPLICATE
          get: function() {
            return presentationComposite();
          },
          enumerable: false,
          configurable: false
        });
      }
      
      
      receiver.needsDisplay = function() {
        // This should be used instead of directly calling render
        pyonContext.registerTarget(receiver);
      }
      
      var removeAnimationInstance = function(animation) {
        var index = allAnimations.indexOf(animation);
        if (index > -1) allAnimations.splice(index,1); // do not deregister yet, must ensure one more tick
      }

      var removalCallback = function(animation,key) {
        if (key !== null && key !== undefined) receiver.removeAnimation(key);
        else removeAnimationInstance(animation);
      }

      receiver.addAnimation = function(animation,name) { // should be able to pass a description if type is registered
        if (!(animation instanceof PyonAnimation) && animation !== null && typeof animation === "object") {
          animation = animationFromDescription(animation);
        }
        
        if (typeof animation === "undefined" || animation === null || !animation instanceof PyonAnimation) throw new Error("Animations must be a Pyon.Animation or subclass.");
        if (!allAnimations.length) pyonContext.registerTarget(receiver);
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



    function PyonLayer() { // Meant to be subclassed to provide implicit animation and clear distinction between model/presentation values
      Pyonify(this);
    }
    PyonLayer.prototype = {};
    PyonLayer.prototype.constructor = PyonLayer;
    PyonLayer.prototype.animationForKey = function(key,value,target) {
      return null;
    };



    function GraphicsLayer() {
      // This should more closely resemble CALayer, PyonLayer just focuses on animations and triggering them
      // This should have renderInContext: instead of render:
      // Provide frame and bounds, allow sublayers.
      // apply transforms.
      // all drawing into top level layer backed object that holds canvas.
      // Only top layer has a canvas element
    }





function PyonAnimation(settings) { // The base animation type
      if (this instanceof PyonAnimation === false) {
        throw new Error("Pyon.Animation is a constructor, not a function. Do not call it directly.");
      }
      if (this.constructor === PyonAnimation) {
        //throw new Error("Pyon.Animation is an abstract base class.");
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
      this.delay = 0; // float. In seconds. // TODO: easing should be taken in effect after the delay
      this.blend = "relative"; // also "absolute" or "zero" // Default should be "absolute" if explicit
      this.additive = true;
      this.sort;
      this.finished = 0;//false;
      this.startTime; // float
      this.delta;
      this.type = PyonNumber;
      this.progress = null;

      if (settings) Object.keys(settings).forEach( function(key) {
        this[key] = settings[key];
      }.bind(this));
    }

    PyonAnimation.prototype = {
      constructor: PyonAnimation,
      composite: function(onto,now) {
        //if (this.startTime === null || this.startTime === undefined) return this.type.zero();
        if (this.startTime === null || this.startTime === undefined) throw new Error("Cannot composite an animation that has not been started.");
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
        else if (this.easing === "step-start") iterationProgress = Math.ceil(iterationProgress);
        else if (this.easing === "step-middle") iterationProgress = Math.round(iterationProgress);
        else if (this.easing === "step-end") iterationProgress = Math.floor(iterationProgress);
        else { 
          // TODO: match web-animations syntax
          // TODO: refine regex, perform once in runAnimation 
         
          var rounded = 0.5-(Math.cos(iterationProgress * Math.PI) / 2);
          if (this.easing) {
            var steps = /(step-start|step-middle|step-end|steps)\((\d+)\)/.exec(this.easing);
            if (steps) {
              var desc = steps[1];
              var count = steps[2];
              if (count > 0) {
                if (desc === "step-start") iterationProgress = Math.ceil(iterationProgress * count) / count;
                else if (desc === "step-middle") iterationProgress = Math.round(iterationProgress * count) / count;
                else if (desc === "step-end" || desc === "steps") iterationProgress = Math.floor(iterationProgress * count) / count;
              } else if (this.easing !== "linear") iterationProgress = rounded;
            } else if (this.easing !== "linear") iterationProgress = rounded;
          } else iterationProgress = rounded;
        }
        var value = (this.blend === "absolute") ? this.type.interpolate(this.from,this.to,iterationProgress) : this.type.interpolate(this.delta,this.type.zero(this.to),iterationProgress); // sending argument to zero() for css transforms
        var property = this.property;
        
        var result = value;
        var underlying = onto[property];
        //if (typeof underlying == "undefined" || underlying === null) underlying = this.type.zero(this.to); // TODO: assess this // FIXME: transform functions? Underlying will never be undefined as it is a registered property, added to modelLayer
        if (this.additive) result = this.type.add(underlying,value);

        if (this.sort && Array.isArray(result)) result.sort(this.sort);
        onto[property] = result;
        
        var changed = (iterationProgress !== this.progress);
        
        this.progress = iterationProgress;
        return changed;
      },

      runAnimation: function(layer,key,removalCallback) {
        if (isFunction(this.type)) this.type = new this.type();
        if (isFunction(this.type.zero) && isFunction(this.type.add) && isFunction(this.type.subtract) && isFunction(this.type.interpolate)) {
          if (!this.duration) this.duration = 0.0; // need better validation. Currently is split across constructor, setter, and here
          if (this.speed === null || this.speed === undefined) this.speed = 1; // need better validation
          if (this.iterations === null || this.iterations === undefined) this.iterations = 1; // negative values have no effect
          if (this.blend !== "absolute") this.delta = this.type.subtract(this.from,this.to);
          
          this.completion = function() { // COMPLETION
            if (!this.fillMode || this.fillMode === "none") {
              removalCallback(this,key);
            }
            if (isFunction(this.onend)) this.onend();
            this.completion = null; // lazy way to keep compositor from calling this twice, during fill phase
          }.bind(this);
          if (this.startTime === null || this.startTime === undefined) this.startTime = pyonContext.currentTransaction().time;
        } else {
          throw new Error("Pyon.Animation runAnimation invalid type. Must implement zero, add, subtract, and interpolate.");
        }
      },
    
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
      }
    }



    function PyonValue(settings) { // The base animation type
      if (this instanceof PyonValue === false) {
        throw new Error("Pyon.ValueType is a constructor, not a function. Do not call it directly.");
      }
      if (this.constructor === PyonValue) {
        throw new Error("Pyon.ValueType is an abstract base class.");
      }
    }
    
    PyonValue.prototype = {
      zero: function() {
        throw new Error("Pyon.ValueType subclasses must implement function: zero()");
      },
      add: function() {
        throw new Error("Pyon.ValueType subclasses must implement function: add(a,b)");
      },
      subtract: function() {
        throw new Error("Pyon.ValueType subclasses must implement function: subtract(a,b) in the form subtract b from a");
      },
      interpolate: function() {
        throw new Error("Pyon.ValueType subclasses must implement function: interpolate(a,b,progress)");
      }
    }



    function PyonNumber(settings) {
      PyonValue.call(this,settings);
    }
    PyonNumber.prototype = Object.create(PyonValue.prototype);
    PyonNumber.prototype.constructor = PyonNumber;
    PyonNumber.prototype.zero = function() {
      return 0;
    };
    PyonNumber.prototype.add = function(a,b) {
      return a + b;
    };
    PyonNumber.prototype.subtract = function(a,b) { // subtract b from a
      return a - b;
    };
    PyonNumber.prototype.interpolate = function(a,b,progress) {
      return a + (b-a) * progress;
    };



    function PyonScale(settings) {
      PyonValue.call(this,settings);
    }
    PyonScale.prototype = Object.create(PyonValue.prototype);
    PyonScale.prototype.constructor = PyonScale;
    PyonScale.prototype.zero = function() {
      return 1;
    };
    PyonScale.prototype.add = function(a,b) {
      return a * b;
    };
    PyonScale.prototype.subtract = function(a,b) { // subtract b from a
      if (b === 0) return 0;
      return a/b;
    };
    PyonScale.prototype.interpolate = function(a,b,progress) {
      return a + (b-a) * progress;
    };



    function PyonArray(type,length,settings) {
      Pyon.ValueType.call(this,settings);
      this.type = type;
      if (isFunction(type)) this.type = new type(settings);
      this.length = length;
    }
    PyonArray.prototype = Object.create(PyonValue.prototype);
    PyonArray.prototype.constructor = PyonArray;
    PyonArray.prototype.zero = function() {
      var array = [];
      var i = this.length;
      while (i--) array.push(this.type.zero());
      return array;
    };
    PyonArray.prototype.add = function(a,b) {
      var array = [];
      for (var i = 0; i < this.length; i++) {
        array.push(this.type.add(a[i],b[i]));
      }
      return array;
    };
    PyonArray.prototype.subtract = function(a,b) { // subtract b from a
      var array = [];
      for (var i = 0; i < this.length; i++) {
        array.push(this.type.subtract(a[i],b[i]));
      }
      return array;
    };
    PyonArray.prototype.interpolate = function(a,b,progress) {
      var array = [];
      for (var i = 0; i < this.length; i++) {
        array.push(this.type.interpolate(a[i],b[i],progress));
      }
      return array;
    };



    function PyonSet(settings) {
      PyonValue.call(this,settings);
    }
    PyonSet.prototype = Object.create(PyonValue.prototype);
    PyonSet.prototype.constructor = PyonSet;
    PyonSet.prototype.zero = function() {
      return [];
    };
    PyonSet.prototype.add = function(a,b) {
      if (!Array.isArray(a) && !Array.isArray(b)) return [];
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      var array = a.slice(0);
      var i = b.length;
      while (i--) {
        if (a.indexOf(b[i]) < 0) array.push(b[i]);
      }
      return array;
    };
    PyonSet.prototype.subtract = function(a,b) { // remove b from a
      if (!Array.isArray(a) && !Array.isArray(b)) return [];
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      var array = a.slice(0);
      var i = b.length;
      while (i--) {
        var loc = array.indexOf(b[i]);
        if (loc > -1) array.splice(loc,1);
      }
      return array;
    };
    PyonSet.prototype.interpolate = function(a,b,progress) {
      if (progress >= 1) return b;
      return a;
    };


    function PyonDict(settings) {
      PyonValue.call(this,settings);
    }
    PyonDict.prototype = Object.create(PyonValue.prototype);
    PyonDict.prototype.constructor = PyonDict;
    PyonDict.prototype.zero = function() {
      return {};
    };
    PyonDict.prototype.add = function(a,b) {
      if (!exists(a) && !exists(b)) return {};
      if (!exists(a)) return b;
      if (!exists(b)) return a;
      var A = Object.keys(a);
      var B = Object.keys(b);
      var dict = {};
      var i = A.length;
      while (i--) {
        var key = A[i];
        dict[key] = a[key];
      }
      var j = B.length;
      while (j--) {
        var key = B[j];
        if (A.indexOf(key) < 0) dict.push(b[key]);
      }
      return dict;
    };
    PyonDict.prototype.subtract = function(a,b) { // remove b from a
      if (!exists(a) && !exists(b)) return {};
      if (!exists(a)) return b;
      if (!exists(b)) return a;
      var A = Object.keys(a);
      var B = Object.keys(b);
      var dict = {};
      var i = A.length;
      while (i--) {
        var key = A[i];
        dict[key] = a[key];
      }
      var j = B.length;
      while (j--) {
        var key = B[j];
        delete dict[key];
      }
      return dict;
    };
    PyonDict.prototype.interpolate = function(a,b,progress) {
      if (progress >= 1) return b;
      return a;
    };


    return {
      Layer: PyonLayer, // The basic layer class, meant to be subclassed
      Animation: PyonAnimation, // The basic animation class.
      ValueType: PyonValue, // Abstract type base class
      NumberType: PyonNumber, // For animating numbers
      ScaleType: PyonScale, // For animating transform scale
      ArrayType: PyonArray, // For animating arrays of other value types
      SetType: PyonSet, // Discrete object collection changes
      DictType: PyonDict, // Discrete key changes
      beginTransaction: pyonContext.beginTransaction.bind(pyonContext),
      commitTransaction: pyonContext.commitTransaction.bind(pyonContext),
      flushTransaction: pyonContext.flushTransaction.bind(pyonContext),
      currentTransaction: pyonContext.currentTransaction.bind(pyonContext),
      disableAnimation: pyonContext.disableAnimation.bind(pyonContext),

      addAnimation: pyonContext.addAnimation.bind(pyonContext),
      removeAnimation: pyonContext.removeAnimation.bind(pyonContext),
      removeAllAnimations: pyonContext.removeAllAnimations.bind(pyonContext),
      animationNamed: pyonContext.animationNamed.bind(pyonContext),
      animationKeys: pyonContext.animationKeys.bind(pyonContext),
      presentationLayer: pyonContext.presentationLayer.bind(pyonContext),
      registerAnimatableProperty: pyonContext.registerAnimatableProperty.bind(pyonContext),

      layerize: pyonContext.layerize.bind(pyonContext),
      pyonify: Pyonify, // To mixin layer functionality in objects that are not PyonLayer subclasses.
    }
  })();

  
  Pyon.noConflict = function() {
    root.Pyon = previousPyon;
    return Pyon;
  }
  if (typeof exports !== "undefined") { // http://www.richardrodger.com/2013/09/27/how-to-make-simple-node-js-modules-work-in-the-browser/
    if (typeof module !== "undefined" && module.exports) exports = module.exports = Pyon;
    exports.Pyon = Pyon;
  } else root.Pyon = Pyon;
  
  //if (typeof module !== "undefined" && typeof module.exports !== "undefined") module.exports = Pyon; // http://www.matteoagosti.com/blog/2013/02/24/writing-javascript-modules-for-both-browser-and-node/
  //else window.Pyon = Pyon;
}).call(this);
