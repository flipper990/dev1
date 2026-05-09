import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './Textarea';

const meta: Meta<typeof Textarea> = {
  title: 'Primitives/Textarea',
  component: Textarea,
  args: {
    placeholder: 'Describe the product requirements',
    rows: 5,
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {};

export const Hover: Story = {
  args: {
    className: '!border-secondary/60',
  },
};

export const Focus: Story = {
  args: {
    autoFocus: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: 'This field is disabled',
  },
};

export const Error: Story = {
  args: {
    invalid: true,
    value: 'Please add at least one acceptance criterion.',
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
