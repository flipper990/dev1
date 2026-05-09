import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { LayoutGrid, Settings, Workflow } from 'lucide-react';
import { Tabs } from './Tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Primitives/Tabs',
  component: Tabs,
};

export default meta;
type Story = StoryObj<typeof Tabs>;

const items = [
  { id: 'overview', label: 'Overview', icon: <LayoutGrid className="h-4 w-4" /> },
  { id: 'pipeline', label: 'Pipeline', icon: <Workflow className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState('overview');
    return <Tabs items={items} value={value} onChange={setValue} />;
  },
};

export const Hover: Story = {
  render: () => {
    const [value, setValue] = useState('overview');
    return <Tabs items={items} value={value} onChange={setValue} />;
  },
};

export const Focus: Story = {
  render: () => {
    const [value, setValue] = useState('overview');
    return <Tabs items={items} value={value} onChange={setValue} autoFocusSelected />;
  },
};

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState('overview');
    return (
      <Tabs
        items={[...items.slice(0, 2), { ...items[2], disabled: true }]}
        value={value}
        onChange={setValue}
      />
    );
  },
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
