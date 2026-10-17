(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TitleStyle = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const defaults = {fontSize: 42, color: '#ffffff', align: 'center'};
  function validateTitleStyle(style) {
    if (style === undefined) return [];
    if (!style || typeof style !== 'object' || Array.isArray(style) || ![Object.prototype, null].includes(Object.getPrototypeOf(style))) return ['title style must be a plain JSON object'];
    const errors = [];
    for (const key of Reflect.ownKeys(style)) {
      if (typeof key !== 'string' || !Object.hasOwn(defaults, key)) { errors.push('title style unknown field'); continue; }
      const descriptor = Object.getOwnPropertyDescriptor(style, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) { errors.push(`title style ${key} must be a JSON value`); continue; }
      const value = descriptor.value;
      if (key === 'fontSize' && (!Number.isFinite(value) || value < 12 || value > 120)) errors.push('title style fontSize must be a finite number 12..120');
      if (key === 'color' && (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))) errors.push('title style color must be #RRGGBB');
      if (key === 'align' && !['left', 'center', 'right'].includes(value)) errors.push('title style align must be left, center or right');
    }
    return errors;
  }
  function resolveTitleStyle(style) {
    const errors = validateTitleStyle(style);
    if (errors.length) throw new Error(errors.join('; '));
    return {...defaults, ...style};
  }
  return {validateTitleStyle, resolveTitleStyle};
});
