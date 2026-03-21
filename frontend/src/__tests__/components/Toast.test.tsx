import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, waitForElementToBeRemoved, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../../components/Toast';

// Test component that uses the toast hook
const TestConsumer = ({ toastDuration }: { toastDuration?: number }) => {
    const { toast, confirm } = useToast();
    return (
        <div>
            <button onClick={() => toast('success', 'Success message', toastDuration)}>Success</button>
            <button onClick={() => toast('error', 'Error message', toastDuration)}>Error</button>
            <button onClick={async () => {
                const result = await confirm({ title: 'Confirm', message: 'Are you sure?' });
                toast('info', result ? 'confirmed' : 'cancelled');
            }}>Confirm</button>
        </div>
    );
};

describe('Toast', () => {
    describe('useToast', () => {
        it('throws when used outside provider', () => {
            const BrokenConsumer = () => {
                useToast();
                return null;
            };
            expect(() => render(<BrokenConsumer />)).toThrow('useToast must be used within <ToastProvider>');
        });
    });

    describe('ToastProvider', () => {
        it('renders children', () => {
            render(
                <ToastProvider>
                    <div>child content</div>
                </ToastProvider>
            );
            expect(screen.getByText('child content')).toBeInTheDocument();
        });

        it('shows success toast', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Success'));
            expect(screen.getByText('Success message')).toBeInTheDocument();
        });

        it('shows error toast', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Error'));
            expect(screen.getByText('Error message')).toBeInTheDocument();
        });

        it('auto-dismisses toast after duration', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer toastDuration={200} />
                </ToastProvider>
            );

            await user.click(screen.getByText('Success'));
            expect(screen.getByText('Success message')).toBeInTheDocument();

            await waitForElementToBeRemoved(() => screen.queryByText('Success message'), { timeout: 1000 });
        });
    });

    describe('ConfirmModal', () => {
        it('shows confirm dialog', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Confirm'));
            expect(screen.getByText('Are you sure?')).toBeInTheDocument();
        });

        it('resolves true on confirm click', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Confirm'));
            // The modal has two buttons; pick the one inside the modal dialog
            const modal = screen.getByText('Are you sure?').closest('div[class*="fixed"]')!;
            const confirmBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent === 'Confirm')!;
            await user.click(confirmBtn);
            await waitFor(() => expect(screen.getByText('confirmed')).toBeInTheDocument());
        });

        it('resolves false on cancel click', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Confirm'));
            await user.click(screen.getByRole('button', { name: /cancel/i }));
            await waitFor(() => expect(screen.getByText('cancelled')).toBeInTheDocument());
        });

        it('resolves false when Escape key is pressed', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Confirm'));
            expect(screen.getByText('Are you sure?')).toBeInTheDocument();
            
            await user.keyboard('{Escape}');
            await waitFor(() => expect(screen.getByText('cancelled')).toBeInTheDocument());
        });

        it('resolves false when clicking outside modal (backdrop)', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Confirm'));
            expect(screen.getByText('Are you sure?')).toBeInTheDocument();
            
            // Click the backdrop - it's the outer fixed div that handles onClick
            const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/60');
            if (backdrop) {
                await user.click(backdrop);
            }
            
            await waitFor(() => expect(screen.getByText('cancelled')).toBeInTheDocument());
        });
    });

    describe('Toast types', () => {
        it('shows warning toast', async () => {
            const WarningConsumer = () => {
                const { toast } = useToast();
                return <button onClick={() => toast('warning', 'Warning message')}>Warning</button>;
            };

            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <WarningConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Warning'));
            expect(screen.getByText('Warning message')).toBeInTheDocument();
        });

        it('shows info toast', async () => {
            const InfoConsumer = () => {
                const { toast } = useToast();
                return <button onClick={() => toast('info', 'Info message')}>Info</button>;
            };

            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <InfoConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Info'));
            expect(screen.getByText('Info message')).toBeInTheDocument();
        });
    });

    describe('Toast dismiss', () => {
        it('dismisses toast when X button is clicked', async () => {
            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <TestConsumer toastDuration={10000} />
                </ToastProvider>
            );

            await user.click(screen.getByText('Success'));
            expect(screen.getByText('Success message')).toBeInTheDocument();

            // Find and click the dismiss button on the toast
            const toast = screen.getByText('Success message').closest('div[class*="flex"]');
            const dismissBtn = toast?.querySelector('button');
            await user.click(dismissBtn!);

            await waitFor(() => {
                expect(screen.queryByText('Success message')).not.toBeInTheDocument();
            });
        });
    });

    describe('ConfirmModal variants', () => {
        it('shows danger variant styling', async () => {
            const DangerConsumer = () => {
                const { toast, confirm } = useToast();
                return (
                    <button onClick={async () => {
                        const result = await confirm({ 
                            title: 'Delete Item', 
                            message: 'This cannot be undone.',
                            variant: 'danger'
                        });
                        toast('info', result ? 'deleted' : 'cancelled');
                    }}>Delete</button>
                );
            };

            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <DangerConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Delete'));
            
            // Modal should be visible with danger styling
            expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
            
            // Confirm button should have red styling (danger variant)
            const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
            expect(confirmBtn).toHaveClass('bg-red-600');
        });

        it('shows custom confirm and cancel labels', async () => {
            const CustomLabelsConsumer = () => {
                const { toast, confirm } = useToast();
                return (
                    <button onClick={async () => {
                        const result = await confirm({ 
                            title: 'Save Changes', 
                            message: 'Do you want to save?',
                            confirmLabel: 'Yes, Save',
                            cancelLabel: 'No, Discard'
                        });
                        toast('info', result ? 'saved' : 'discarded');
                    }}>Save</button>
                );
            };

            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <CustomLabelsConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Save'));
            
            expect(screen.getByRole('button', { name: 'Yes, Save' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'No, Discard' })).toBeInTheDocument();
        });
    });

    describe('Toast stack management', () => {
        it('keeps maximum 5 toasts', async () => {
            const MultiToastConsumer = () => {
                const { toast } = useToast();
                return (
                    <button onClick={() => {
                        for (let i = 1; i <= 7; i++) {
                            toast('info', `Message ${i}`, 10000);
                        }
                    }}>Spam</button>
                );
            };

            const user = userEvent.setup();
            render(
                <ToastProvider>
                    <MultiToastConsumer />
                </ToastProvider>
            );

            await user.click(screen.getByText('Spam'));
            
            // Should only show last 5 toasts (3-7)
            await waitFor(() => {
                expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
                expect(screen.queryByText('Message 2')).not.toBeInTheDocument();
                expect(screen.getByText('Message 3')).toBeInTheDocument();
                expect(screen.getByText('Message 7')).toBeInTheDocument();
            });
        });
    });
});
