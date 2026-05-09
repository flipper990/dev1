import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../../../components/ui';
import { Modal } from './Modal';

const meta: Meta<typeof Modal> = { title: 'Phase4/Modal', component: Modal };
export default meta;
type Story = StoryObj<typeof Modal>;

export const Open: Story = {
  args: {
    open: true,
    title: 'Confirm recovery action',
    description: 'This will restart preview services and keep build artifacts intact.',
    children: <div className="flex justify-end gap-2"><Button variant="secondary">Cancel</Button><Button>Restart preview</Button></div>,
    onClose: () => {},
  },
};
