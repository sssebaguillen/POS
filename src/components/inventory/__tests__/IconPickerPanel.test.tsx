// @vitest-environment jsdom
import '@/test/dom'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IconPickerPanel from '@/components/inventory/IconPickerPanel'

// Cubre el refactor de set-state-in-effect → derivar estado durante el render:
// reabrir el panel con otra selección debe re-sincronizar el estado local, pero
// re-renders que no cambian las props deben preservar la edición en curso.
describe('IconPickerPanel', () => {
  it('confirma el icono y color seleccionados localmente', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <IconPickerPanel selectedIcon="Tag" selectedColor="#7a3e10" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Alimentos' })) // -> Apple
    await user.click(screen.getByRole('button', { name: '#16a34a' }))    // verde
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(onConfirm).toHaveBeenCalledWith('Apple', '#16a34a')
  })

  it('re-sincroniza el estado local cuando cambian las props (panel reabierto)', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { rerender } = render(
      <IconPickerPanel selectedIcon="Tag" selectedColor="#7a3e10" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )

    // Edición en curso que luego debe descartarse.
    await user.click(screen.getByRole('button', { name: 'Alimentos' }))
    expect(screen.getByRole('button', { name: 'Alimentos' })).toHaveAttribute('aria-pressed', 'true')

    // Reabrir con otra selección -> el estado local se resetea a las nuevas props.
    rerender(
      <IconPickerPanel selectedIcon="Shirt" selectedColor="#2563eb" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Ropa' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Alimentos' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onConfirm).toHaveBeenCalledWith('Shirt', '#2563eb')
  })

  it('preserva la edición en re-renders que no cambian las props', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const props = { selectedIcon: 'Tag', selectedColor: '#7a3e10', onConfirm, onCancel: vi.fn() }
    const { rerender } = render(<IconPickerPanel {...props} />)

    await user.click(screen.getByRole('button', { name: 'Alimentos' }))
    rerender(<IconPickerPanel {...props} />) // mismas props -> no resetea

    expect(screen.getByRole('button', { name: 'Alimentos' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onConfirm).toHaveBeenCalledWith('Apple', '#7a3e10')
  })
})
