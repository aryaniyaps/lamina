import type {
  ActionProps,
  ButtonProps,
  ChartProps,
  FieldProps,
  FlowProps,
  HeadingProps,
  ImageProps,
  LinkProps,
  MetricProps,
  PlaceholderProps,
  ProgressProps,
  ScreenProps,
  SearchProps,
  SelectProps,
  SubBaseProps,
  TableProps,
  TransitionProps,
  TriggerProps,
} from '../types.js';
import { assertPreviewContext, isPreviewEnv } from '../env.js';

function wrap(
  name: string,
  className: string,
  sub: string,
  { children, metadata }: SubBaseProps,
  extra?: Record<string, string | undefined>,
) {
  assertPreviewContext(name);
  return (
    <div
      className={className}
      data-sub={sub}
      data-metadata={metadata ? JSON.stringify(metadata) : undefined}
      {...extra}
    >
      {children}
    </div>
  );
}

function Triggerable({
  sub,
  className,
  trigger,
  label,
  children,
  tag = 'span',
}: TriggerProps & { sub: string; className: string; tag?: 'span' | 'a' | 'button' }) {
  assertPreviewContext(sub);
  const content = label ?? children;
  const attrs = {
    className: `${className}${trigger ? ' sub-trigger' : ''}`,
    'data-sub': sub,
    'data-trigger': trigger,
    'data-sub-trigger': trigger,
    role: tag === 'span' ? 'button' : undefined,
  };
  if (tag === 'a') return <a {...attrs}>{content}</a>;
  if (tag === 'button') return <button type="button" {...attrs}>{content}</button>;
  return <span {...attrs}>{content}</span>;
}

export function Application({ children }: SubBaseProps) {
  assertPreviewContext('Application');
  return <div className="sub-application" data-sub="Application">{children}</div>;
}

export function Screen({ id, title, children }: ScreenProps) {
  assertPreviewContext('Screen');
  if (isPreviewEnv()) {
    return (
      <div data-sub="Screen" data-screen-id={id}>
        {children}
      </div>
    );
  }
  return (
    <div className="sub-screen" data-sub="Screen" data-screen-id={id}>
      {title ? <div className="sub-screen-label">{title}</div> : null}
      <div className="sub-screen-body">{children}</div>
    </div>
  );
}

export function Flow({ id, children }: FlowProps) {
  assertPreviewContext('Flow');
  return (
    <div className="sub-flow" data-sub="Flow" data-flow-id={id}>
      {children}
    </div>
  );
}

export function Page(props: SubBaseProps) {
  return wrap('Page', 'sub-page', 'Page', props);
}

export function Header(props: SubBaseProps) {
  return wrap('Header', 'sub-header', 'Header', props);
}

export function Footer(props: SubBaseProps) {
  return wrap('Footer', 'sub-footer', 'Footer', props);
}

export function Main(props: SubBaseProps) {
  return wrap('Main', 'sub-main', 'Main', props);
}

export function Section(props: SubBaseProps) {
  return wrap('Section', 'sub-section', 'Section', props);
}

export function Sidebar(props: SubBaseProps) {
  return wrap('Sidebar', 'sub-sidebar', 'Sidebar', props);
}

export function Row(props: SubBaseProps) {
  return wrap('Row', 'sub-row', 'Row', props);
}

export function Column(props: SubBaseProps) {
  return wrap('Column', 'sub-column', 'Column', props);
}

export function Stack(props: SubBaseProps) {
  return wrap('Stack', 'sub-stack', 'Stack', props);
}

export function Grid(props: SubBaseProps) {
  return wrap('Grid', 'sub-grid', 'Grid', props);
}

export function Tabs(props: SubBaseProps) {
  return wrap('Tabs', 'sub-tabs', 'Tabs', props);
}

export function SplitLayout(props: SubBaseProps) {
  return wrap('SplitLayout', 'sub-split-layout', 'SplitLayout', props);
}

export function ScrollArea(props: SubBaseProps) {
  return wrap('ScrollArea', 'sub-scroll-area', 'ScrollArea', props);
}

export function Overlay(props: SubBaseProps) {
  return wrap('Overlay', 'sub-overlay', 'Overlay', props);
}

export function Heading({ children, level = 2 }: HeadingProps) {
  assertPreviewContext('Heading');
  const className = 'sub-heading';
  if (level === 1) return <h1 className={className} data-sub="Heading">{children}</h1>;
  if (level === 3) return <h3 className={className} data-sub="Heading">{children}</h3>;
  if (level === 4) return <h4 className={className} data-sub="Heading">{children}</h4>;
  return <h2 className={className} data-sub="Heading">{children}</h2>;
}

export function Text({ children }: SubBaseProps) {
  assertPreviewContext('Text');
  return <p className="sub-text" data-sub="Text">{children}</p>;
}

export function Button({ children, label, trigger }: ButtonProps) {
  return (
    <Triggerable sub="Button" className="sub-button" trigger={trigger} label={label}>
      {children}
    </Triggerable>
  );
}

export function Action(props: ActionProps) {
  return <Triggerable sub="Action" className="sub-action" tag="button" {...props} />;
}

export function Link({ children, label, trigger, href }: LinkProps) {
  assertPreviewContext('Link');
  return (
    <a
      className={`sub-link${trigger ? ' sub-trigger' : ''}`}
      data-sub="Link"
      data-trigger={trigger}
      data-sub-trigger={trigger}
      href={href ?? '#'}
    >
      {label ?? children}
    </a>
  );
}

export function Toolbar(props: SubBaseProps) {
  return wrap('Toolbar', 'sub-toolbar', 'Toolbar', props);
}

export function ActionMenu(props: SubBaseProps) {
  return wrap('ActionMenu', 'sub-action-menu', 'ActionMenu', props);
}

export function Field({ name, label, type, required, children }: FieldProps) {
  assertPreviewContext('Field');
  return (
    <label className="sub-field" data-sub="Field" data-name={name} data-sub-name={name} data-type={type}>
      <span className="sub-field-label">
        {label ?? name}
        {required ? ' *' : ''}
      </span>
      <input
        className="sub-field-input"
        type={type ?? 'text'}
        name={name}
        required={required}
        aria-label={label ?? name}
      />
      {children}
    </label>
  );
}

export function Form(props: SubBaseProps) {
  return wrap('Form', 'sub-form', 'Form', props);
}

export function Search({ name, label, children }: SearchProps) {
  assertPreviewContext('Search');
  return (
    <label className="sub-search" data-sub="Search" data-name={name}>
      {label ? <span className="sub-field-label">{label}</span> : null}
      <input
        className="sub-search-input"
        type="search"
        name={name}
        placeholder="Search…"
        aria-label={label ?? name ?? 'Search'}
      />
      {children}
    </label>
  );
}

export function TextArea({ name, label, children }: FieldProps) {
  assertPreviewContext('TextArea');
  return (
    <label className="sub-textarea" data-sub="TextArea" data-name={name}>
      <span className="sub-field-label">{label ?? name}</span>
      <textarea className="sub-textarea-box" name={name} rows={4} aria-label={label ?? name} />
      {children}
    </label>
  );
}

export function Select({ name, label, options, children }: SelectProps) {
  assertPreviewContext('Select');
  return (
    <label className="sub-select" data-sub="Select" data-name={name}>
      <span className="sub-field-label">{label ?? name}</span>
      <select className="sub-select-box" name={name} aria-label={label ?? name} defaultValue="">
        <option value="" disabled>
          Select…
        </option>
        {options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {children}
    </label>
  );
}

export function Checkbox({ name, label, children }: FieldProps) {
  assertPreviewContext('Checkbox');
  return (
    <label className="sub-checkbox" data-sub="Checkbox" data-name={name}>
      <input className="sub-checkbox-input" type="checkbox" name={name} aria-label={label ?? name} />
      <span className="sub-checkbox-box" />
      {label ?? name}
      {children}
    </label>
  );
}

export function Radio({ name, label, children }: FieldProps) {
  assertPreviewContext('Radio');
  return (
    <label className="sub-radio" data-sub="Radio" data-name={name}>
      <input className="sub-radio-input" type="radio" name={name} aria-label={label ?? name} />
      <span className="sub-radio-dot" />
      {label ?? name}
      {children}
    </label>
  );
}

export function Toggle({ name, label, children }: FieldProps) {
  assertPreviewContext('Toggle');
  return (
    <label className="sub-toggle" data-sub="Toggle" data-name={name}>
      <input className="sub-toggle-input" type="checkbox" name={name} aria-label={label ?? name} />
      <span className="sub-toggle-track" />
      <span className="sub-field-label">{label ?? name}</span>
      {children}
    </label>
  );
}

export function DatePicker({ name, label, children }: FieldProps) {
  assertPreviewContext('DatePicker');
  return (
    <label className="sub-datepicker" data-sub="DatePicker" data-name={name}>
      <span className="sub-field-label">{label ?? name}</span>
      <input className="sub-datepicker-box" type="date" name={name} aria-label={label ?? name} />
      {children}
    </label>
  );
}

export function FileUpload({ name, label, children }: FieldProps) {
  assertPreviewContext('FileUpload');
  return (
    <label className="sub-file-upload" data-sub="FileUpload" data-name={name}>
      <span className="sub-field-label">{label ?? name}</span>
      <input className="sub-file-upload-input" type="file" name={name} aria-label={label ?? name} />
      {children}
    </label>
  );
}

export function Table({ source, columns, children }: TableProps) {
  assertPreviewContext('Table');
  return (
    <div className="sub-table" data-sub="Table" data-source={source} data-sub-source={source}>
      {columns?.length ? (
        <div className="sub-table-header">
          {columns.map((col) => (
            <span key={col} className="sub-table-cell">
              {col}
            </span>
          ))}
        </div>
      ) : null}
      <div className="sub-table-body">{children ?? <div className="sub-table-row">…</div>}</div>
    </div>
  );
}

export function List(props: SubBaseProps) {
  assertPreviewContext('List');
  return (
    <div className="sub-list" data-sub="List">
      <ul className="sub-list-items">{props.children}</ul>
    </div>
  );
}

export function Navigation(props: SubBaseProps) {
  return wrap('Navigation', 'sub-navigation', 'Navigation', props);
}

export function Breadcrumb(props: SubBaseProps) {
  return wrap('Breadcrumb', 'sub-breadcrumb', 'Breadcrumb', props);
}

export function Menu(props: SubBaseProps) {
  return wrap('Menu', 'sub-menu', 'Menu', props);
}

export function UserMenu(props: SubBaseProps) {
  return wrap('UserMenu', 'sub-user-menu', 'UserMenu', props);
}

export function Pagination(props: SubBaseProps) {
  return wrap('Pagination', 'sub-pagination', 'Pagination', props);
}

export function Stepper(props: SubBaseProps) {
  return wrap('Stepper', 'sub-stepper', 'Stepper', props);
}

export function TabBar(props: SubBaseProps) {
  return wrap('TabBar', 'sub-tab-bar', 'TabBar', props);
}

export function Image({ alt, children }: ImageProps) {
  assertPreviewContext('Image');
  return (
    <div className="sub-image" data-sub="Image" data-alt={alt}>
      <span className="sub-image-placeholder">{alt ?? 'Image'}</span>
      {children}
    </div>
  );
}

export function Avatar({ children }: SubBaseProps) {
  assertPreviewContext('Avatar');
  return (
    <div className="sub-avatar" data-sub="Avatar">
      <span className="sub-avatar-circle">{children ?? '◯'}</span>
    </div>
  );
}

export function Metric({ label, value, children }: MetricProps) {
  assertPreviewContext('Metric');
  return (
    <div className="sub-metric" data-sub="Metric">
      <span className="sub-metric-label">{label ?? 'Metric'}</span>
      <span className="sub-metric-value">{value ?? '—'}</span>
      {children}
    </div>
  );
}

export function Chart({ label, children }: ChartProps) {
  assertPreviewContext('Chart');
  return (
    <div className="sub-chart" data-sub="Chart">
      <span className="sub-chart-label">{label ?? 'Chart'}</span>
      <pre className="sub-chart-stub" aria-hidden>
        {`  ╭─╮\n ╭╯ ╰╮\n╭╯   ╰╮`}
      </pre>
      {children}
    </div>
  );
}

export function Timeline(props: SubBaseProps) {
  return wrap('Timeline', 'sub-timeline', 'Timeline', props);
}

export function Badge({ children }: SubBaseProps) {
  assertPreviewContext('Badge');
  return (
    <span className="sub-badge" data-sub="Badge">
      {children}
    </span>
  );
}

export function CodeBlock({ children }: SubBaseProps) {
  assertPreviewContext('CodeBlock');
  return (
    <pre className="sub-code-block" data-sub="CodeBlock">
      {children ?? '// code'}
    </pre>
  );
}

export function Loading(props: SubBaseProps) {
  return wrap('Loading', 'sub-loading', 'Loading', props);
}

export function Alert(props: SubBaseProps) {
  return wrap('Alert', 'sub-alert', 'Alert', props);
}

export function Toast(props: SubBaseProps) {
  return wrap('Toast', 'sub-toast', 'Toast', props);
}

export function Banner(props: SubBaseProps) {
  return wrap('Banner', 'sub-banner', 'Banner', props);
}

export function EmptyState(props: SubBaseProps) {
  return wrap('EmptyState', 'sub-empty-state', 'EmptyState', props);
}

export function ErrorState(props: SubBaseProps) {
  return wrap('ErrorState', 'sub-error-state', 'ErrorState', props);
}

export function SuccessState(props: SubBaseProps) {
  return wrap('SuccessState', 'sub-success-state', 'SuccessState', props);
}

export function Progress({ value = 50, children }: ProgressProps) {
  assertPreviewContext('Progress');
  return (
    <div className="sub-progress" data-sub="Progress">
      <div className="sub-progress-bar" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      {children}
    </div>
  );
}

export function Transition({ trigger, target, from }: TransitionProps) {
  assertPreviewContext('Transition');
  return (
    <div
      className="sub-transition"
      data-sub="Transition"
      data-trigger={trigger}
      data-target={target}
      data-from={from}
    >
      [{from ?? 'screen'}] —{trigger}→ {target}
    </div>
  );
}

export function Placeholder({ as, label, children }: PlaceholderProps) {
  assertPreviewContext('Placeholder');
  return (
    <div className="sub-placeholder" data-sub="Placeholder" data-as={as}>
      <span className="sub-placeholder-label">{label ?? as}</span>
      {children}
    </div>
  );
}
