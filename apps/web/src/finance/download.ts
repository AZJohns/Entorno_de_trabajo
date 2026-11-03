/** Descarga de un archivo generado en el navegador, sin pasar por la red ni por una URL externa. */

/** Guarda `text` como un archivo JSON llamado `filename`. */
export function saveJsonFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Se libera después del clic: algunos navegadores empiezan la descarga de forma asíncrona.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
