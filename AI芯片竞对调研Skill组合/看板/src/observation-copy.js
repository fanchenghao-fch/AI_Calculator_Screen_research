(function (root, factory) {
  const observationCopy = factory();
  if (typeof module === 'object' && module.exports) module.exports = observationCopy;
  else root.observationCopy = observationCopy;
})(globalThis, function () {
  'use strict';
  // Presentation only: archived Markdown stays intact, including its original wording.
  return function observationCopy(value = '') {
    return String(value)
      .replace(/(?:\*\*)?(?:完成程度|研究完成度)[：:]\s*(?:\*\*)?(?:部分完成|未完成|完成)(?:\*\*)?[。；：:]?(?:\*\*)?\s*/g, '')
      .replace(/((?:R|S)\d+)[／/](?:部分完成|未完成|完成)([：:]?)/g, '$1$2')
      .replace(/^(\s*(?:[-*]\s*)?)(?:\*\*)?(?:部分完成|未完成|完成)(?:\*\*)?\s*[：:。]\s*/gm, '$1')
      .trim();
  };
});
