import type { Meta, StoryObj } from '@storybook/react';
import { PreviewCanvasFrame } from './PreviewCanvasFrame';

const meta: Meta<typeof PreviewCanvasFrame> = { title: 'Phase3/PreviewCanvasFrame', component: PreviewCanvasFrame };
export default meta;
type Story = StoryObj<typeof PreviewCanvasFrame>;

export const Empty: Story = { args: { ready: false } };
export const Loading: Story = { args: { loading: true } };
export const Success: Story = { args: { ready: true, url: 'https://example.com' } };
export const Failure: Story = { args: { failed: true, message: 'Preview failed while starting server.' } };
