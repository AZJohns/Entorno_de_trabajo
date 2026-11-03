import { useEffect, type RefObject } from 'react';

/**
 * Lleva el foco al primer campo con error cuando aparecen mensajes de validación, para que quien usa
 * teclado o lector de pantalla no tenga que buscarlos. Se apoya en `aria-invalid`, que ponen los
 * controles de `ui/finance-forms.tsx`.
 */
export function useFocusInvalid(
  formRef: RefObject<HTMLFormElement | null>,
  errors: Readonly<Record<string, string>>,
): void {
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, formRef]);
}
