import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './Select';

const meta: Meta<typeof Select> = {
  title: 'Primitives/Select',
  component: Select,
  render: (args) => (
    <Select {...args}>
      <option value="studio">Studio workspace</option>
      <option value="billing">Billing workspace</option>
      <option value="sandbox">Sandbox workspace</option>
    </Select>
  ),
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {};

export const Focus: Story = {
  args: { autoFocus: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Error: Story = {
  args: { invalid: true },
};

export const LightMode: Story = {
  ...Default,
  globals: { theme: 'light' },
};

export const DarkMode: Story = {
  ...Default,
  globals: { theme: 'dark' },
};

