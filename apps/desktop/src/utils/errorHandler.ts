export function errorHandler(error: unknown, context: string = ''): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context || 'Error'}]:`, error);
  
  // TODO: Send to error reporting service
  // TODO: Show user-friendly toast notification
  
  // Prevent app crash
  if (error instanceof Error && 'stack' in error) {
    console.error(error.stack);
  }
}

export function handleAsyncError<T>(
  promise: Promise<T>,
  context: string = ''
): Promise<T> {
  return promise.catch((error) => {
    errorHandler(error, context);
    throw error; // Re-throw to allow caller handling
  });
}

