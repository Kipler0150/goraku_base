import { fireEvent, screen, within } from '@testing-library/react';

export function selectView(name) {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary', exact: true })).getByRole('button', { name, exact: true }));
}

export function openTracking() {
  document.querySelectorAll('.library-edit:not([open]) > summary').forEach((summary) => fireEvent.click(summary));
}
