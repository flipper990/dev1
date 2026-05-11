import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardTitle } from './Card';

const meta: Meta<typeof Card> = {
  title: 'Primitives/Card',
  component: Card,
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: (args) => (
    <Card {...args}>
      <CardTitle>Build summary</CardTitle>
      <p className="text-body-s text-text-secondary">4 stages completed. 2 checks pending.</p>
    </Card>
  ),
};

export const Hover: Story = {
  render: (args) => (
    <Card {...args} interactive className="!bg-surface-tint">
      <CardTitle>Interactive card</CardTitle>
      <p className="text-body-s text-text-secondary">Hover treatment preview.</p>
    </Card>
  ),
};

export const Focus: Story = {
  render: (args) => (
    <Card {...args} tabIndex={0} className="focus-visible:shadow-[var(--focus-ring)]">
      <CardTitle>Focusable card</CardTitle>
      <p className="text-body-s text-text-secondary">Keyboard focus ring preview.</p>
    </Card>
  ),
};

export const Highlight: Story = {
  render: (args) => (
    <Card {...args} highlight>
      <CardTitle>Highlighted</CardTitle>
      <p className="text-body-s text-text-secondary">Primary border and tint.</p>
    </Card>
  ),
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};
