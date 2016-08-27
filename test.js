var Pyon = require('./pyon');
var assert = require('assert');

// describe('Array', function() {
//   describe('#indexOf()', function () {
//     it('should return -1 when the value is not present', function () {
//       assert.equal(-1, [1,2,3].indexOf(5));
//       assert.equal(-1, [1,2,3].indexOf(0));
//     });
//   });
// });


describe('Pyon.Layer subclass', function() {

  var Layer = function() {
    Pyon.Layer.call(this);
    this.one = 1;
    this.two = 2;
  }
//   var layer = {
//     one:1,
//     two:2
//   }
//   Pyon.decorate(layer);
  
  var layer = new Layer();
  var modelLayer = layer.modelLayer;

  describe('modelLayer', function () {
    it('exists', function () {
      assert(modelLayer !== null && typeof modelLayer !== "undefined");
    });
    it('property one', function () {
      assert(modelLayer.one === 1);
    });
    it('property two', function () {
      assert(modelLayer.two === 2);
    });
  });

  var presentationLayer = layer.presentationLayer;
  
  describe('presentationLayer', function () {
    it('exists', function () {
      assert(presentationLayer !== null && typeof presentationLayer !== "undefined");
    });
    it('non animated content one', function () {
      assert(presentationLayer.one === 1);
    });
    it('non animated content two', function () {
      assert(presentationLayer.two === 2);
    });
  });















});