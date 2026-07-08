import type { ReactNode } from 'react';

export type SubMetadata = Record<string, string | number | boolean | undefined>;

export interface SubBaseProps {
  children?: ReactNode;
  metadata?: SubMetadata;
}

export interface ScreenProps extends SubBaseProps {
  id: string;
  title?: string;
}

export interface FlowProps extends SubBaseProps {
  id: string;
}

export interface TransitionProps {
  trigger: string;
  target: string;
  from?: string;
}

export interface TriggerProps {
  trigger?: string;
  label?: string;
  children?: ReactNode;
}

export interface FieldProps extends SubBaseProps {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
}

export interface TableProps extends SubBaseProps {
  source?: string;
  columns?: string[];
}

export interface PlaceholderProps extends SubBaseProps {
  as: string;
  label?: string;
}

export interface HeadingProps extends SubBaseProps {
  level?: 1 | 2 | 3 | 4;
}

export interface ButtonProps extends SubBaseProps, TriggerProps {}

export interface ActionProps extends SubBaseProps, TriggerProps {}

export interface LinkProps extends SubBaseProps, TriggerProps {
  href?: string;
}

export interface ImageProps extends SubBaseProps {
  alt?: string;
}

export interface MetricProps extends SubBaseProps {
  label?: string;
  value?: string;
}

export interface ChartProps extends SubBaseProps {
  label?: string;
}

export interface SearchProps extends SubBaseProps {
  name?: string;
  label?: string;
}

export interface SelectProps extends SubBaseProps {
  name?: string;
  label?: string;
  options?: string[];
}

export interface ProgressProps extends SubBaseProps {
  value?: number;
}

export type ForbiddenBlueprintProps = {
  className?: never;
  style?: never;
};
