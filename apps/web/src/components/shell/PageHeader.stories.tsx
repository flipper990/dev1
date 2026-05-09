import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from './PageHeader';

const meta: Meta<typeof PageHeader> = {
  title: 'Shell/PageHeader',
  component: PageHeader,
  args: {
    title: 'Projects',
    subtitle: 'Track delivery readiness and operational status.',
    lifecycle: { label: 'Operational', tone: 'active' },
    breadcrumbs: [
      { label: 'Workspace', href: '/' },
      { label: 'Projects' },
    ],
    actions: <Button>New project</Button>,
    secondaryActions: <Button variant="secondary">Export</Button>,
  },
};

export default meta;
type Story = StoryObj<typeof PageHeader>;

export const Default: Story = {};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
