/** SUB components exported from @lamina/studio (keep in sync with src/index.ts). */
export const ALLOWED_COMPONENTS = new Set([
  'Application',
  'Screen',
  'Flow',
  'Page',
  'Header',
  'Footer',
  'Main',
  'Section',
  'Sidebar',
  'Row',
  'Column',
  'Stack',
  'Grid',
  'Tabs',
  'SplitLayout',
  'ScrollArea',
  'Overlay',
  'Heading',
  'Text',
  'Button',
  'Action',
  'Link',
  'Toolbar',
  'ActionMenu',
  'Field',
  'Form',
  'Search',
  'TextArea',
  'Select',
  'Checkbox',
  'Radio',
  'Toggle',
  'DatePicker',
  'FileUpload',
  'Table',
  'List',
  'Navigation',
  'Breadcrumb',
  'Menu',
  'UserMenu',
  'Pagination',
  'Stepper',
  'TabBar',
  'Image',
  'Avatar',
  'Metric',
  'Chart',
  'Timeline',
  'Badge',
  'CodeBlock',
  'Loading',
  'Alert',
  'Toast',
  'Banner',
  'EmptyState',
  'ErrorState',
  'SuccessState',
  'Progress',
  'Transition',
  'Placeholder',
  'Fragment',
]);

/**
 * @param {string} source
 * @returns {string[]}
 */
export function parseJsxComponentTags(source) {
  const tags = new Set();
  const re = /<([A-Z][a-zA-Z0-9]*)\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    tags.add(m[1]);
  }
  return [...tags];
}
