import type { Meta, StoryObj } from '@storybook/react';
import { Badge, Button, Card } from '../../../components/ui';
import { AppShell } from './AppShell';

const meta: Meta<typeof AppShell> = {
  title: 'Shell/AppShell',
  component: AppShell,
};

export default meta;
type Story = StoryObj<typeof AppShell>;

function ShellDemo() {
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-title-s text-ink">Main canvas</h2>
        <p className="mt-2 text-body-s text-secondary">Primary work stays central and readable.</p>
        <div className="mt-4"><Badge variant="neutral">Focused layout</Badge></div>
      </Card>
      <Card>
        <p className="text-body-s text-secondary">Secondary information is pushed to contextual surfaces.</p>
      </Card>
    </div>
  );
}

const baseArgs = {
  title: 'Overview',
  subtitle: 'Calm software production workspace.',
  lifecycle: { label: 'Operational', tone: 'active' as const },
  breadcrumbs: [{ label: 'Workspace' }, { label: 'Overview' }],
  actions: <Button>New project</Button>,
  secondaryActions: <Button variant="secondary">Invite</Button>,
  contextTitle: 'Context',
  contextContent: <Card><p className="text-body-s text-secondary">Diagnostics and metadata live here.</p></Card>,
  defaultContextOpen: true,
  workspaceName: 'DEVteam Studio',
  children: <ShellDemo />,
};

export const Mobile: Story = {
  render: () => (
    <div className="mx-auto max-w-[390px] overflow-hidden border border-border">
      <AppShell {...baseArgs} />
    </div>
  ),
};

export const Tablet: Story = {
  render: () => (
    <div className="mx-auto max-w-[900px] overflow-hidden border border-border">
      <AppShell {...baseArgs} />
    </div>
  ),
};

export const Desktop: Story = {
  render: () => (
    <div className="mx-auto max-w-[1280px] overflow-hidden border border-border">
      <AppShell {...baseArgs} />
    </div>
  ),
};

export const Widescreen: Story = {
  render: () => (
    <div className="mx-auto max-w-[1680px] overflow-hidden border border-border">
      <AppShell {...baseArgs} />
    </div>
  ),
};

export const ExperimentLightFirst: Story = {
  ...Desktop,
  globals: { theme: 'light' },
};

export const ExperimentDarkFirst: Story = {
  ...Desktop,
  globals: { theme: 'dark' },
};
