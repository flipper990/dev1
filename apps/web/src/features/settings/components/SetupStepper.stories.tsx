import type { Meta, StoryObj } from '@storybook/react';
import { SetupStepper } from './SetupStepper';

const meta: Meta<typeof SetupStepper> = { title: 'Phase4/SetupStepper', component: SetupStepper };
export default meta;
type Story = StoryObj<typeof SetupStepper>;

export const Empty: Story = {};
export const Loading: Story = {
  render: () => <SetupStepper onComplete={() => {}} />,
};
export const Success: Story = {
  render: () => <SetupStepper onComplete={() => {}} />,
};
