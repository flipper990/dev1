import type { Meta, StoryObj } from '@storybook/react';
import { ProjectCommandDock } from './ProjectCommandDock';

const meta: Meta<typeof ProjectCommandDock> = { title: 'Phase3/ProjectCommandDock', component: ProjectCommandDock };
export default meta;
type Story = StoryObj<typeof ProjectCommandDock>;

export const Empty: Story = {};
export const Loading: Story = { args: { busy: true } };
