declare module '@storybook/react' {
  export interface Meta<T = unknown> {
    title?: string;
    component?: T;
    args?: Record<string, unknown>;
    render?: (args: Record<string, unknown>) => unknown;
    parameters?: Record<string, unknown>;
    tags?: string[];
    argTypes?: Record<string, unknown>;
  }

  export type StoryObj<TMetaOrCmp = unknown> = {
    args?: Record<string, unknown>;
    render?: (args: Record<string, unknown>) => unknown;
    parameters?: Record<string, unknown>;
    globals?: Record<string, unknown>;
  } & Record<string, unknown>;
}
