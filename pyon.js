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
    
    var DELEGATE_MASSAGE_INPUT_OUTPUT = true;
    
    // TODO: Handle no window and no performance.now
    
    var rAF = typeof window !== "undefined" && (
        window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        window.oRequestAnimationFrame
      ) || function(callback) { setTimeout(callback, 0) };

    var cAF = typeof window !== "undefined" && (
        window.cancelAnimationFrame ||
        window.webkitCancelRequestAnimationFrame ||
        window.webkitCancelAnimationFrame ||
        window.mozCancelAnimationFrame ||
        window.msCancelAnimationFrame ||
        window.oCancelAnimationFrame
      ) || function() {}; // TODO: cAF only used in flush() which is not supported yet

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
      this.displaying = false;
      this.animationFrame;

      this.mixins = [];
      this.modelLayers = []; // model layers // TODO: Cache presentation layers so you don't have to repeatedly calculate?
      this.displayLayers = []; // cachedPresentationLayer
      this.unlayerize = function(modelLayer) {}; // TODO: implement. Or not.
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
      beginTransaction: function(settings) { // TODO: throw on unclosed (user created) transaction
        this.createTransaction(settings,false);
      },
      commitTransaction: function() {
        var transaction = this.transactions.pop();
      },
      flushTransaction: function() { // TODO: prevent unterminated when called within display
        if (this.animationFrame) cAF(this.animationFrame); // Unsure if cancelling animation frame is needed.
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
          this.displayLayers.push(null); // cachedPresentationLayer
        }
      },

      deregisterTarget: function(target) {
        var index = this.targets.indexOf(target);
        if (index > -1) {
          this.targets.splice(index, 1);
          this.displayLayers.splice(index, 1); // cachedPresentationLayer
        }
      },
      startTicking: function() { // TODO: consider cancelling previous animation frame.
        if (!this.animationFrame) this.animationFrame = rAF(this.ticker.bind(this));
      },
      ticker: function() { // Need to manually cancel animation frame if calling directly.
        this.animationFrame = undefined;
        var targets = this.targets; // experimental optimization, traverse backwards so you can remove. This has caused problems for me before, but I don't think I was traversing backwards.
        var i = targets.length;
        
        while (i--) {
          var target = targets[i];
          if (!target.animationCount) { // Deregister from inside ticker is redundant (removalCallback & removeAnimationInstance), but is still needed when needsDisplay()
            this.deregisterTarget(target); // Deregister here to ensure one more tick after last animation has been removed. Different behavior than removalCallback & removeAnimationInstance, for example needsDisplay()
          }
          var display = target.delegate.display;
          if (!isFunction(display)) display = target.display;
          if (isFunction(display)) {
            this.displaying = true;
            var presentationLayer = target.presentationLayer;
            if (this.displayLayers[i] != presentationLayer) { // This is to suppress unnecessary displays. TODO: need isEqual.
              if (target.animationCount) this.displayLayers[i] = presentationLayer; // cachedPresentationLayer
              display.call(target.delegate);
            }
            this.displaying = false;
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
      if (description && description instanceof PyonValue) {
        throw new Error("Types are not animations."); // TODO: Allow passing a type as well as a description. It mostly already works, properties are copied just fine, you would just need to set the animation type to the original type's prototype.constructor.
      } else if (description && description instanceof PyonAnimation) {
        animation = description.copy();
      } else if (description && typeof description === "object") {
        animation = new PyonAnimation(description);
      } else if (isNumber(description)) animation = new PyonAnimation({duration:description});
      
      if (animation) {
        if (isFunction(animation.type)) animation.type = new animation.type();
        if (!animation.duration) animation.duration = 0.0; // TODO: need better validation. Currently split across constructor, setter, and here
        if (animation.speed === null || typeof animation.speed === "undefined") animation.speed = 1; // need better validation
        if (animation.iterations === null || typeof animation.iterations === "undefined") animation.iterations = 1; // negative values have no effect
      }
      return animation;
    };


    var presentationCompositePublic = function(sourceLayer, sourceAnimations, time) {
      if (time === null || typeof time === "undefined") time = 0;
      var resultAnimations = []
      if (Array.isArray(sourceAnimations)) resultAnimations = sourceAnimations.map( function(animation) {
        var animation = animationFromDescription(animation);
        if (animation && (animation.startTime === null || typeof animation.startTime === "undefined")) animation.startTime = time;
        if (!animation.from) animation.from = animation.type.zero();
        if (!animation.to) animation.to = animation.type.zero();
        if (animation.blend !== "absolute") animation.delta = animation.type.subtract(animation.from,animation.to);
        return animation;
      });
      else if (sourceAnimations) resultAnimations = Object.keys(sourceAnimations).map( function(key) {
        var animation = animationFromDescription(sourceAnimations[key]);
        if (animation && (animation.startTime === null || typeof animation.startTime === "undefined")) animation.startTime = time;
        if (!animation.from) animation.from = animation.type.zero();
        if (!animation.to) animation.to = animation.type.zero();
        if (animation.blend !== "absolute") animation.delta = animation.type.subtract(animation.from,animation.to);
        return animation;
      });
      return presentationTransform(sourceLayer, resultAnimations, time, true, null, []);
    }




    var presentationTransform = function(sourceLayer,sourceAnimations,time,shouldSortAnimations,cachedPresentationLayer,finishedAnimations) { // COMPOSITING // New version but does not properly assign or return cachedPresentationLayer to suppress unnecessary displays if not animating. Less important than when animating.
      var verbose = false;
      if (false) Object.keys(sourceLayer).forEach( function(key) {
        if (key === "transform") verbose = true;
      });
      if (false) sourceAnimations.forEach( function(animation) {
        if (animation.property === "transform") verbose = true;
      });
      var presentationLayer = Object.assign({},sourceLayer); // You need to make sure display has non animated properties for example this.element
      if (!sourceAnimations || !sourceAnimations.length) {
        if (verbose) console.log("*** *** *** Pyon presentationTransform changed:%s; source:%s; result:%s;",progressChanged,sourceAnimations.length,JSON.stringify(presentationLayer));
        return presentationLayer;
      }
      if (shouldSortAnimations) { // no argument means it will sort
        sourceAnimations.sort( function(a,b) {
          var A = a.index, B = b.index;
          if (A === null || A === undefined) A = 0;
          if (B === null || B === undefined) B = 0;
          var result = A - B;
          if (!result) result = a.startTime - b.startTime;
          if (!result) result = a.number - b.number; // animation number is needed because sort is not guaranteed to be stable
          return result;
        });
      }
      var progressChanged = false;
      sourceAnimations.forEach( function(animation) {
        progressChanged = animation.composite(presentationLayer,time) || progressChanged;
        if (animation.finished > 1) throw new Error("Animation finishing twice is not possible");
        if (animation.finished > 0) finishedAnimations.push(animation);
      });
      if (!progressChanged && sourceAnimations.length && !finishedAnimations.length) {
        if (cachedPresentationLayer) return cachedPresentationLayer
      }
      return presentationLayer;
    }



    function Pyonify(receiver, modelInstance, delegateInstance) { // should be renamed: controller, layer, delegate // maybe reordered: layer, controller, delegate
      if (receiver.pyonified) throw new Error("Can't Pyonify twice.");
      receiver.pyonified = true;
      var modelDict = {}; // TODO: Unify modelDict, modelInstance, modelLayer. This is convoluted. Looking forward to having proxy
      var registeredProperties = [];
      var allAnimations = [];
      var namedAnimations = {};
      var defaultAnimations = {};
      //var animationCount = 0; // need to implement auto increment key
      var shouldSortAnimations = false;
      var animationNumber = 0; // order added
      var cachedPresentationLayer = null;
      var cachedPresentationTime = -1;
      if (modelInstance === null || typeof modelInstance === "undefined") modelInstance = {};
      if (delegateInstance === null || typeof delegateInstance === "undefined") delegateInstance = {};
      var controllerInstance = receiver;
      if (controllerInstance === null || typeof controllerInstance === "undefined") controllerInstance = {};
      var previousLayer = {}; // TODO: need better rules for resetting values to become current. Doing when layer is asked for doesn't work if PyonReact privately uses it.

      var layerDescription = { // conditional with new handling of arguments
        get: function() {
          return modelInstance;
        },
        enumerable: true,
        configurable: false
      }
      if (receiver != modelInstance) layerDescription["set"] = function(layer) { // TODO: consider react like union instead of set
        modelInstance = layer;
        Object.keys(layer).forEach( function(key) {
          controllerInstance.registerAnimatableProperty(key);
        });
      }
      Object.defineProperty(receiver, "layer", layerDescription);


      var delegateDescription = { // conditional with new handling of arguments
        get: function() {
          return delegateInstance;
        },
        enumerable: true,
        configurable: false
      }
      if (receiver != delegateInstance) delegateDescription["set"] = function(theDelegate) {
        delegateInstance = theDelegate;
      }
      Object.defineProperty(receiver, "delegate", delegateDescription);


      var controllerDescription = { // conditional with new handling of arguments
        get: function() {
          return controllerInstance;
        },
        enumerable: true,
        configurable: false
      }
      var controllerSetter = function(theController) {
        controllerInstance = theController;
        decorateTarget(theController); // side effects up the
      }
      if (receiver != controllerInstance) controllerDescription["set"] = controllerSetter;
      Object.defineProperty(receiver, "controller", controllerDescription);


      var implicitAnimation = function(property,value) { // TODO: Ensure modelLayer is fully populated before calls to animationForKey so you can use other props conditionally to determine animation
        var description;
        var delegate = delegateInstance;
        if (isFunction(delegate.animationForKey)) description = delegate.animationForKey.call(delegate,property,value);
        var animation = animationFromDescription(description);
        if (!animation) animation = animationFromDescription(defaultAnimations[property]);
        if (animation) {
          if (animation.property === null || typeof animation.property === "undefined") animation.property = property;
          if (animation.from === null || typeof animation.from === "undefined") {
            if (animation.blend === "absolute") animation.from = receiver.controller.presentationLayer[property]; // use presentation layer
            else animation.from = modelDict[property];
          }
          if (animation.to === null || typeof animation.to === "undefined") animation.to = value;
        }
        return animation;
      };

      var valueForKey = function(property) {
        if (pyonContext.displaying && cachedPresentationLayer) return cachedPresentationLayer[property];
        return modelDict[property];
      };

      var setValueForKey = function(value,property) {
        if (value === modelDict[property]) return; // New in Pyon! No animation if no change. This filters out repeat setting of unchanging model values while animating. Function props are always not equal (if you're not careful)
        previousLayer[property] = valueForKey(property); // for previousLayer.
        var animation;
        var transaction = pyonContext.currentTransaction(); // Pyon bug! This transaction might not get closed.
        if (!transaction.disableAnimation) { // TODO: Does React setState batching mean disabling implicit state animation is impossible?
          animation = implicitAnimation(property,value);
          if (animation) controllerInstance.addAnimation(animation); // this will copy a second time.
        }
        modelDict[property] = value;
        cachedPresentationLayer = null;
        if (!animation) controllerInstance.needsDisplay();
      };

      var removeAnimationInstance = function(animation) {
        var index = allAnimations.indexOf(animation);
        if (index > -1) allAnimations.splice(index,1);
        var ensureOneMoreTick = false; // true = do not deregister yet, to ensure one more tick, but it is no longer needed. Redundant code in ticker to remove should not get called (but don't remove it just yet)
        if (!ensureOneMoreTick) {
          if (!allAnimations.length) {
            pyonContext.deregisterTarget(receiver);
          }
        }
      }

      var removalCallback = function(animation,key) {
        if (key !== null && key !== undefined) controllerInstance.removeAnimation(key);
        else removeAnimationInstance(animation);
      }

      var controller = controllerInstance;

      var convertedValueOfPropertyWithFunction = function(value,property,funky) { // DELEGATE_MASSAGE_INPUT_OUTPUT // mutates
        if (isFunction(funky)) return funky(property,value);
        return value;
      }
      var convertPropertyOfObjectWithFunction = function(property,object,funky) { // DELEGATE_MASSAGE_INPUT_OUTPUT // mutates
        if (object && isFunction(funky)) {
          var value = object[property];
          if (value !== null && typeof value !== "undefined") object[property] = funky(property,value);
        }
      }
      var convertPropertiesOfObjectWithFunction = function(properties,object,funky) { // DELEGATE_MASSAGE_INPUT_OUTPUT // mutates
        properties.forEach( function(property) {
          convertPropertyOfObjectWithFunction(property,object,funky);
        });
      }
      var convertPropertiesAsPropertyOfObjectWithFunction = function(properties,object,funky) { // animation from, to, and delta // DELEGATE_MASSAGE_INPUT_OUTPUT // mutates
        if (object && isFunction(funky)) {
          var property = object.property;
          properties.forEach( function(item) {
            var value = object[item];
            if (value !== null && typeof value !== "undefined") object[item] = funky(property,value);
            convertPropertyOfObjectWithFunction(property,object,funky);
          });
        }
      }

      controller.registerAnimatableProperty = function(property, defaultValue) { // Workaround for lack of Proxy // Needed to trigger implicit animation. // FIXME: defaultValue is broken. TODO: Proper default animations dictionary.
        if (registeredProperties.indexOf(property) === -1) registeredProperties.push(property);
        var descriptor = Object.getOwnPropertyDescriptor(modelInstance, property);
        //if (descriptor && descriptor.configurable === false) { // need automatic registration
          //return; // Fail silently so you can set default animation by registering it again
        //}
        var defaultAnimation = animationFromDescription(defaultValue);
        if (DELEGATE_MASSAGE_INPUT_OUTPUT) convertPropertiesAsPropertyOfObjectWithFunction(["from","to","delta"],defaultAnimation,delegateInstance.input);
        
        if (defaultAnimation) defaultAnimations[property] = defaultAnimation; // maybe set to defaultValue not defaultAnimation
        else if (defaultAnimations[property] === null) delete defaultAnimations[property]; // property is still animatable
        
        if (!descriptor || descriptor.configurable === true) {
          var modelLayer = receiver.layer;
          modelDict[property] = modelLayer[property];
          Object.defineProperty(modelLayer, property, { // ACCESSORS
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

      Object.defineProperty(controller, "animationCount", { // Performs better than asking for animations.length, especially when ticking.
        get: function() {
          return allAnimations.length;
        },
        enumerable: true,
        configurable: false
      });

      Object.defineProperty(controller, "animations", {
        get: function() {
          var array = allAnimations.map(function (animation) {
            var copy = animation.copy(); // TODO: optimize me. Lots of copying. Potential optimization. Instead maybe freeze properties.
            if (DELEGATE_MASSAGE_INPUT_OUTPUT) convertPropertiesAsPropertyOfObjectWithFunction(["from","to","delta"],copy,delegateInstance.output);
            return copy
          });
          return array;
        },
        enumerable: true,
        configurable: false
      });

      Object.defineProperty(controller, "animationNames", {
        get: function() {
          return Object.keys(namedAnimations);
        },
        enumerable: true,
        configurable: false
      });

      Object.defineProperty(controller, "modelLayer", { // TODO: setLayer or just plain layer
        get: function() {
          var modelLayer = modelInstance;
          var layer = {};
          registeredProperties.forEach( function(key) {
            var value = modelDict[key];
            if (DELEGATE_MASSAGE_INPUT_OUTPUT) value = convertedValueOfPropertyWithFunction(value, key, delegateInstance.output);
            Object.defineProperty(layer, key, { // modelInstance has defined properties. Must redefine.
              value: value,
              enumerable: true,
              configurable: false
            });
          });
          Object.freeze(layer);
          return layer;
        },
        enumerable: true,
        configurable: false
      });

      Object.defineProperty(controller, "previousLayer", {
        get: function() { // fuct
          var layer = Object.assign({},modelDict); // // // //
          Object.keys(previousLayer).forEach( function(key) {
            var value = previousLayer[key];
            if (DELEGATE_MASSAGE_INPUT_OUTPUT) value = convertedValueOfPropertyWithFunction(value, key, delegateInstance.output);
            Object.defineProperty(layer, key, {
              value: value,
              enumerable: true,
              configurable: false
            });
            previousLayer[key] = modelDict[key];
          });
          Object.freeze(layer);
          return layer;
        },
        enumerable: true,
        configurable: false
      });

      Object.defineProperty(controller, "presentationLayer", {
        get: function() {
          
          var finishedAnimations = [];
          var time = 0; // Temporary workaround. Not sure if still needed. It should be safe to create transactions.
          if (allAnimations.length) { // Do not create a transaction if there are no animations else the transaction will not be automatically closed.
            var transaction = pyonContext.currentTransaction();
            time = transaction.time;
          }
          var presentationLayer = presentationTransform(modelDict,allAnimations,time,shouldSortAnimations,cachedPresentationLayer,finishedAnimations);
          if (DELEGATE_MASSAGE_INPUT_OUTPUT && presentationLayer != cachedPresentationLayer) convertPropertiesOfObjectWithFunction(Object.keys(presentationLayer),presentationLayer,delegateInstance.output);
          cachedPresentationLayer = presentationLayer; // You must always set this
          finishedAnimations.forEach( function(animation) {
            if (isFunction(animation.completion)) animation.completion();
          });
          
          shouldSortAnimations = false;
          return presentationLayer;
        },
        enumerable: true,
        configurable: false
      });

      controller.needsDisplay = function() { // This should be used instead of directly calling display
        pyonContext.registerTarget(receiver);
      }

      controller.addAnimation = function(animation,name) { // should be able to pass a description if type is registered
        if (false && animation.property) controllerObject.registerAnimatableProperty(animation.property); // Sure why not
        animation = animationFromDescription(animation);
        if (typeof animation === "undefined" || animation === null || !animation instanceof PyonAnimation) throw new Error("Animations must be a Pyon.Animation or subclass.");
        if (DELEGATE_MASSAGE_INPUT_OUTPUT) {
          var originalValue = animation.to;
          convertPropertiesAsPropertyOfObjectWithFunction(["from","to","delta"],animation,delegateInstance.input);
          if (isFunction(delegateInstance.typeOfProperty)) {
            var type = delegateInstance.typeOfProperty.call(delegateInstance,animation.property,animation.to);
            if (type !== null && typeof type !== "undefined") animation.type = type;
          }
        }
        if (!allAnimations.length) pyonContext.registerTarget(receiver);
        var copy = animation.copy();
        copy.number = animationNumber++;
        allAnimations.push(copy);
        if (name !== null && typeof name !== "undefined") {
          var previous = namedAnimations[name];
          if (previous) removeAnimationInstance(previous); // after pushing to allAnimations, so context doesn't stop ticking
          namedAnimations[name] = copy;
        }
        shouldSortAnimations = true;
        copy.runAnimation(receiver, name, removalCallback);
      }

      controller.removeAnimation = function(name) {
        var animation = namedAnimations[name];
        if (animation) {
          removeAnimationInstance(animation);
          delete namedAnimations[name];
          var delegate = animation.delegate;
          if (exists(delegate)) { // do here not in removeAnimationInstance because delegate animationDidStop gets called when animations enter fill phase, not when removed.
            if (isFunction(delegate.animationDidStop)) {
              delegate.animationDidStop.call(delegate,animation.settings,false);
            }
            animation.delegate = null;
          }
        }
      }

      controller.removeAllAnimations = function() {
        allAnimations.length = 0;
        namedAnimations = {};
        allAnimations.forEach( function(animation) {
          var delegate = animation.delegate;
          if (exists(delegate)) { // do here not in removeAnimationInstance because delegate animationDidStop gets called when animations enter fill phase, not when removed.
            if (isFunction(delegate.animationDidStop)) {
              delegate.animationDidStop.call(delegate,animation.settings,false);
            }
            animation.delegate = null;
          }
        });
      }

      controller.animationNamed = function(name) {
        var animation = namedAnimations[name];
        if (animation) {
          var copy = animation.copy();
          if (DELEGATE_MASSAGE_INPUT_OUTPUT) convertPropertiesAsPropertyOfObjectWithFunction(["from","to","delta"],copy,delegateInstance.output);
          return copy;
        }
        return null;
      }

    }



    function PyonLayer() { // Meant to be subclassed to provide implicit animation and clear distinction between model/presentation values
      Pyonify(this,this,this); // new, layer does not provide layer or delegate accessors
    }
    PyonLayer.prototype = {};
    PyonLayer.prototype.constructor = PyonLayer;
    PyonLayer.prototype.animationForKey = function(key,value,target) {
      return null;
    };
    PyonLayer.prototype.display = function() {
    };

    function PyonView() { // Meant to be subclassed to provide implicit animation and clear distinction between model/presentation values
      Pyonify(this, {}, this); // provides layer accessor but not delegate
    }
    PyonView.prototype = {};
    PyonView.prototype.constructor = PyonView;
    PyonView.prototype.animationForKey = function(key,value,target) {
      return null;
    };
    PyonView.prototype.display = function() {
    };



    function PyonAnimation(settings) { // The base animation class
      if (this instanceof PyonAnimation === false) {
        throw new Error("Pyon.Animation is a constructor, not a function. Do not call it directly.");
      }
      if (this.constructor === PyonAnimation) {
        //throw new Error("Pyon.Animation is an abstract base class.");
      }
      //this.settings = settings;
      this.property; // string, property name
      this.from; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
      this.to; // type specific. Subclasses must implement zero, add, subtract and interpolate. invert is no longer used
      this.duration = 0.0; // float. In seconds. Need to validate/ensure >= 0.
      this.easing; // NOT FINISHED. currently callback function only, need cubic bezier and presets. Defaults to linear
      this.speed = 1.0; // NOT FINISHED. float. RECONSIDER. Pausing currently not possible like in Core Animation. Layers have speed, beginTime, timeOffset!
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
      this.progress = null; // 0 would mean first frame does not count as a change which I want for stepEnd but probably not anything else. Also complicating is separate cachedPresentationlayer and context displayLayers
      this.onend; // NOT FINISHED. callback function, fires regardless of fillMode. Should rename. Should also implement didStart, maybe didTick, etc.
      this.delegate; // Maybe I should use this instead of onend
      
      if (settings) Object.keys(settings).forEach( function(key) {
        this[key] = settings[key];
      }.bind(this));

      Object.defineProperty(this, "settings", {
        get: function() {
          var result = Object.assign({},settings); // TODO: Use Object.assign polyfill
          Object.keys(this).forEach( function(key) {
            if (key !== "settings") result[key] = this[key];
          }.bind(this));
          return result;
        },
        enumerable: false, // temporary, until I have a nicely formatted toString and toJSON
        configurable: true // gets copied
      });

    }

    PyonAnimation.prototype = {
      constructor: PyonAnimation,
//       toString: function() {
//         return JSON.stringify(this.settings);
//       },
//       toJSON: function() {
//         return this.settings.toString();
//       },
      composite: function(onto,now) {
        if (this.startTime === null || this.startTime === undefined) throw new Error("Cannot composite an animation that has not been started."); // return this.type.zero();
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
         // FIXME: step-end displays twice (actually thrice). Should I just display once, not at the start?
         
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
        if (typeof underlying == "undefined" || underlying === null) underlying = this.type.zero(this.to); // TODO: assess this // FIXME: transform functions? Underlying will never be undefined as it is a registered property, added to modelLayer

        if (this.additive) result = this.type.add(underlying,value);

        if (this.sort && Array.isArray(result)) result.sort(this.sort);

        onto[property] = result;
        
        var changed = (iterationProgress !== this.progress);
        
        this.progress = iterationProgress;

        return changed;
      },

      runAnimation: function(layer,key,removalCallback) {
        if (isFunction(this.type.zero) && isFunction(this.type.add) && isFunction(this.type.subtract) && isFunction(this.type.interpolate)) {
          if (!this.from) this.from = this.type.zero(this.to);
          if (!this.to) this.to = this.type.zero(this.from);
          if (this.blend !== "absolute") {
            this.delta = this.type.subtract(this.from,this.to);
          }
          this.completion = function() { // COMPLETION
            if (!this.fillMode || this.fillMode === "none") {
              removalCallback(this,key);
            }
            if (isFunction(this.onend)) this.onend();
            var delegate = this.delegate;
            if (exists(delegate)) { // do here not in removeAnimationInstance because delegate animationDidStop gets called when animations enter fill phase, not when removed.
              if (isFunction(delegate.animationDidStop)) {
                delegate.animationDidStop.call(delegate,this.settings,true);
              }
              this.delegate = null;
            }
            this.completion = null; // lazy way to keep compositor from calling this twice, during fill phase
          }.bind(this);
          if (this.startTime === null || this.startTime === undefined) this.startTime = pyonContext.currentTransaction().time;
        } else {
          throw new Error("Pyon.Animation runAnimation invalid type. Must implement zero, add, subtract, and interpolate.");
        }
      },
    
      copy: function() { // TODO: "Not Optimized. Reference to a variable that requires dynamic lookup" !!! // https://github.com/GoogleChrome/devtools-docs/issues/53
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



    function PyonValue(settings) { // The base type class
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
      interpolate: function(a,b,progress) { // new, meant to be overridden, otherwise you get discrete.
        //throw new Error("Pyon.ValueType subclasses must implement function: interpolate(a,b,progress)");
        if (progress >= 1) return b;
        return a;
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
      if (isFunction(settings)) this.sort = settings;
      else if (settings && isFunction(settings.sort)) this.sort = settings.sort;
    }
    PyonSet.prototype = Object.create(PyonValue.prototype);
    PyonSet.prototype.constructor = PyonSet;
    PyonSet.prototype.zero = function() {
      return [];
    };
    PyonSet.prototype.add = function(a,b) { // add b to a
      if (!Array.isArray(a) && !Array.isArray(b)) return [];
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      
      var array = [];
      var aLength = a.length;
      var bLength = b.length;
      var i = 0;
      var j = 0;
      if (isFunction(this.sort)) while (i < aLength || j < bLength) {
        if (i == aLength) {
          array.push(b[j]);
          j++;
        } else if (j == bLength) {
          array.push(a[i]);
          i++;
        } else {
          var A = a[i];
          var B = b[j];
          var sort = this.sort(A,B);
          if (sort === 0) {
            array.push(A);
            i++;
            j++;
          } else if (sort < 0) {
            array.push(A);
            i++;
          } else if (sort > 0) {
            array.push(B);
            j++;
          }
        }
      } else {
        array = a.slice(0);
        i = b.length;
        while (i--) {
          if (a.indexOf(b[i]) < 0) array.push(b[i]);
        }
      }
      return array;
    };
    PyonSet.prototype.subtract = function(a,b) { // remove b from a
      if (!Array.isArray(a) && !Array.isArray(b)) return [];
      if (!Array.isArray(a)) return b;
      if (!Array.isArray(b)) return a;
      
      var array = [];
      var aLength = a.length;
      var bLength = b.length;
      var i = 0;
      var j = 0;
      if (isFunction(this.sort)) while (i < aLength || j < bLength) {
        if (i == aLength) {
          break;
        } else if (j == bLength) {
          array.push(a[i]);
          i++;
        } else {
          var A = a[i];
          var B = b[j];
          var sort = this.sort(A,B);
          if (sort === 0) {
            i++;
            j++;
          } else if (sort < 0) {
            array.push(A);
            i++;
          } else if (sort > 0) {
            j++;
          }
        }
      } else {
        array = a.slice(0);
        i = b.length;
        while (i--) {
          var loc = array.indexOf(b[i]);
          if (loc > -1) array.splice(loc,1);
        }
      }
      return array;
    };
    PyonSet.prototype.interpolate = function(a,b,progress) {
      if (progress >= 1) return b;
      return a;
    };


    function PyonDict(settings) {
      PyonValue.call(this,settings);
      throw new Error("PyonDict not supported");
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
      var dict = {};
      Object.keys(a).forEach( function(key) {
        dict[key] = a[key];
      });
      Object.keys(b).forEach( function(key) {
        dict[key] = b[key];
      });
      return dict;
    };
    PyonDict.prototype.subtract = function(a,b) { // remove b from a // probably remove keys from a not in b
      var dict = {};
      Object.keys(a).forEach( function(key) {
        if (exists(b[key])) dict[key] = a[key];
      });
      return dict;
//       if (!exists(a) && !exists(b)) return {};
//       if (!exists(a)) return b;
//       if (!exists(b)) return a;
//       var A = Object.keys(a);
//       var B = Object.keys(b);
//       var dict = {};
//       var i = A.length;
//       while (i--) {
//         var key = A[i];
//         dict[key] = a[key];
//       }
//       var j = B.length;
//       while (j--) {
//         var key = B[j];
//         delete dict[key];
//       }
//       console.log("Pyon Dict subtract a:%s; b:%s; result:%s;",JSON.stringify(a),JSON.stringify(b),JSON.stringify(dict));
//       return dict;
    };
    PyonDict.prototype.interpolate = function(a,b,progress) {
      if (progress >= 1) return b;
      return a;
    };



    function PyonPoint(settings) {
      PyonValue.call(this,settings);
    }
    PyonPoint.prototype = Object.create(PyonValue.prototype);
    PyonPoint.prototype.constructor = PyonPoint;
    PyonPoint.prototype.zero = function() {
      return PyonZeroPoint();
    };
    PyonPoint.prototype.add = function(a,b) {
      return PyonMakePoint(a.x + b.x, a.y + b.y);
    };
    PyonPoint.prototype.subtract = function(a,b) { // subtract b from a
      return PyonMakePoint(a.x - b.x, a.y - b.y);
    };
    PyonPoint.prototype.interpolate = function(a,b,progress) {
      return PyonMakePoint(a.x + (b.x-a.x) * progress, a.y + (b.y-a.y) * progress);
    };



    function PyonSize(settings) {
      PyonValue.call(this,settings);
    }
    PyonSize.prototype = Object.create(PyonValue.prototype);
    PyonSize.prototype.constructor = PyonSize;
    PyonSize.prototype.zero = function() {
      return PyonZeroSize();
    };
    PyonSize.prototype.add = function(a,b) {
      return PyonMakeSize(a.width + b.width, a.height + b.height);
    };
    PyonSize.prototype.subtract = function(a,b) { // subtract b from a
      return PyonMakeSize(a.width - b.width, a.height - b.height);
    };
    PyonSize.prototype.interpolate = function(a,b,progress) {
      return PyonMakeSize(a.width + (b.width-a.width) * progress, a.height + (b.height-a.height) * progress);
    };



    function PyonRect(settings) {
      PyonValue.call(this,settings);
    }
    PyonRect.prototype = Object.create(PyonValue.prototype);
    PyonRect.prototype.constructor = PyonRect;
    PyonRect.prototype.zero = function() {
      return PyonZeroRect();
    };
    PyonRect.prototype.add = function(a,b) {
      return {
        origin: PyonPoint.prototype.add(a.origin, b.origin),
        size: PyonSize.prototype.add(a.size, b.size)
      }
    };
    PyonRect.prototype.subtract = function(a,b) { // subtract b from a
      return {
        origin: PyonPoint.prototype.subtract(a.origin, b.origin),
        size: PyonSize.prototype.subtract(a.size, b.size)
      }
    };
    PyonRect.prototype.interpolate = function(a,b,progress) {
      return {
        origin: PyonPoint.prototype.interpolate(a.origin, b.origin, progress),
        size: PyonSize.prototype.interpolate(a.size, b.size, progress)
      }
    };



    function PyonRange(settings) { // TODO: negative values? // This should union the whole range, not add the individual values. NSUnionRange, not NSIntersectionRange, which is a range containing the indices that exist in both ranges.
      PyonValue.call(this,settings);
      throw new Error("PyonRange not supported");
    }
    PyonRange.prototype = Object.create(PyonValue.prototype);
    PyonRange.prototype.constructor = PyonRange;
    PyonRange.prototype.zero = function() {
      return PyonNullRange();
    };
    PyonRange.prototype.add = function(a,b) {  // union?
      if (a.location === PyonNotFound && b.location === PyonNotFound) return PyonNullRange();
      if (a.length === 0 && b.length === 0) return PyonNullRange();
      if (a.location === PyonNotFound || a.length === 0) return b;
      if (b.location === PyonNotFound || b.length === 0) return a;
      var finalLocation = Math.min( a.location, b.location );
      var finalEnd = Math.max( a.location + a.length, b.location + b.length );
      var result = PyonMakeRange(finalLocation, finalEnd - finalLocation );
      return result;
    };
    PyonRange.prototype.subtract = function(a,b) { // Subtraction is completely different.
      var result = a;
      if (a.location === PyonNotFound && b.location === PyonNotFound) result = PyonNullRange();
      else if (a.length === 0 && b.length === 0) result = PyonNullRange();
      else if (a.location === PyonNotFound || a.length === 0) result = PyonNullRange();
      else if (b.location === PyonNotFound || b.length === 0) result = a;
      else if (b.location <= a.location && b.location + b.length >= a.location + a.length) result = PyonNullRange();
      else if (b.location <= a.location && b.location + b.length > a.location && b.location + b.length < a.location + a.length) result = PyonMakeRange(b.location + b.length, (a.location + a.length) - (b.location + b.length));
      else if (b.location > a.location && b.location < a.location + a.length && b.location + b.length >= a.location + a.length) result = PyonMakeRange(a.location, (b.location + b.length) - a.location);
      return a;
    };
    PyonRange.prototype.interpolate = function(a,b,progress) {
      if (progress >= 1) return b;
      return a;
    };
    PyonRange.prototype.intersection = function(a,b) { // 0,1 and 1,1 do not intersect
      if (a.location === PyonNotFound || b.location === PyonNotFound || a.length === 0 || b.length === 0) return PyonNullRange();
      if (a.location + a.length <= b.location || b.location + b.length <= a.location) return PyonNullRange(); // TODO: Consider location should be NSNotFound (INT_MAX) not zero.
      var finalLocation = Math.max( a.location, b.location );
      var finalEnd = Math.min( a.location + a.length, b.location + b.length );
      return Pyon.makeRange(finalLocation, finalEnd - finalLocation);
    };

    var PyonNotFound = Number.MAX_VALUE;
    // struct convenience constructors:
    function PyonMakeRect(x,y,width,height) {
      return {
        origin: PyonMakePoint(x,y),
        size: PyonMakeSize(width,height)
      };
    }
    function PyonZeroRect() {
      return PyonMakeRect(0,0,0,0);
    }
    function PyonEqualRects(a,b) {
      return (PyonEqualPoints(a.origin,b.origin) && PyonEqualSizes(a.size,b.size));
    }

    function PyonMakePoint(x,y) {
      return {
        x: x,
        y: y
      };
    }
    function PyonZeroPoint() {
      return PyonMakePoint(0,0);
    }
    function PyonEqualPoints(a,b) {
      return (a.x === b.x && a.y === b.y);
    }

    function PyonMakeSize(width, height) {
      return {
        width: width,
        height: height
      };
    }
    function PyonZeroSize() {
      return PyonMakeSize(0,0);
    }
    function PyonEqualSizes(a,b) {
      return (a.width === b.width && a.height && b.height);
    }

    function PyonMakeRange(location, length) {
      return {
        location: location,
        length: length
      }
    }
    function PyonZeroRange() {
      return PyonMakeRange(0,0);
    }
    function PyonNullRange() {
      return PyonMakeRange(PyonNotFound,0);
    }
    function PyonIndexInRange(index,range) {
      return (index > range.location && index < range.location + range.length);
    }
    function PyonEqualRanges(a,b) {
      return (a.location === b.location && a.length === b.length);
    }
    function PyonIntersectionRange(a,b) {
      if (a.location + a.length <= b.location || b.location + b.length <= a.location) return PyonNullRange();
      var location = Math.max( a.location, b.location );
      var end = Math.min( a.location + a.length, b.location + b.length );
      return { location: location, length: end - location };
    }

    return {
      Layer: PyonLayer, // The basic layer class, meant to be subclassed
      Animation: PyonAnimation, // The basic animation class.
      ValueType: PyonValue, // Abstract type base class
      NumberType: PyonNumber, // For animating numbers
      ScaleType: PyonScale, // For animating transform scale, a single axis.
      ArrayType: PyonArray, // For animating arrays of other value types
      SetType: PyonSet, // Discrete object collection changes
      PointType: PyonPoint, // Like NSPoint
      SizeType: PyonSize, // Like NSSize
      RectType: PyonRect, // Like NSRect
      RangeType: PyonRange, // Discrete. Like NSRange but allows non-integer values. Maybe it shouldn't. TODO: Consider converting to integers

      makeRect: PyonMakeRect,
      zeroRect: PyonZeroRect, // TODO: should be a getter not a function
      equalRects: PyonEqualRects,
      makeSize: PyonMakeSize,
      zeroSize: PyonZeroSize, // TODO: should be a getter not a function
      equalSizes: PyonEqualSizes,
      makePoint: PyonMakePoint,
      zeroPoint: PyonZeroPoint, // TODO: should be a getter not a function
      equalPoints: PyonEqualPoints,
      makeRange: PyonMakeRange,
      zeroRange: PyonZeroRange, // TODO: should be a getter not a function // Maybe zero range location should be PyonNotFound
      nullRange: PyonNullRange, // TODO: should be a getter not a function
      indexInRange: PyonIndexInRange,
      equalRanges: PyonEqualRanges,
      intersectionRange: PyonIntersectionRange,
      notFound: PyonNotFound,

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
      registerAnimatableProperty: pyonContext.registerAnimatableProperty.bind(pyonContext), // workaround for lack of Proxy

      composite: presentationCompositePublic,

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
