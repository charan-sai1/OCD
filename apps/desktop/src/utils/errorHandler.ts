export interface ErrorDetails {
  code: string;
  message: string;
  context?: Record<string, any>;
  timestamp: number;
  recoverable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryCondition?: (error: ErrorDetails) => boolean;
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: ErrorDetails[] = [];
  private readonly maxLogSize = 100;

  private constructor() {}

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  // Handle image loading errors
  handleImageLoadError(imagePath: string, error: unknown, context?: Record<string, any>): ErrorDetails {
    const errorDetails: ErrorDetails = {
      code: 'IMAGE_LOAD_FAILED',
      message: `Failed to load image: ${imagePath}`,
      context: {
        imagePath,
        originalError: error instanceof Error ? error.message : String(error),
        ...context
      },
      timestamp: Date.now(),
      recoverable: true,
      severity: 'medium'
    };

    this.logError(errorDetails);
    return errorDetails;
  }

  // Handle cache errors
  handleCacheError(operation: string, error: unknown, context?: Record<string, any>): ErrorDetails {
    const errorDetails: ErrorDetails = {
      code: 'CACHE_OPERATION_FAILED',
      message: `Cache ${operation} failed`,
      context: {
        operation,
        originalError: error instanceof Error ? error.message : String(error),
        ...context
      },
      timestamp: Date.now(),
      recoverable: true,
      severity: 'medium'
    };

    this.logError(errorDetails);
    return errorDetails;
  }

  // Handle system resource errors
  handleSystemResourceError(resource: string, error: unknown, context?: Record<string, any>): ErrorDetails {
    const errorDetails: ErrorDetails = {
      code: 'SYSTEM_RESOURCE_ERROR',
      message: `System resource ${resource} error`,
      context: {
        resource,
        originalError: error instanceof Error ? error.message : String(error),
        ...context
      },
      timestamp: Date.now(),
      recoverable: false,
      severity: 'high'
    };

    this.logError(errorDetails);
    return errorDetails;
  }

  // Handle thumbnail generation errors
  handleThumbnailError(imagePath: string, error: unknown, context?: Record<string, any>): ErrorDetails {
    const errorDetails: ErrorDetails = {
      code: 'THUMBNAIL_GENERATION_FAILED',
      message: `Failed to generate thumbnail for: ${imagePath}`,
      context: {
        imagePath,
        originalError: error instanceof Error ? error.message : String(error),
        ...context
      },
      timestamp: Date.now(),
      recoverable: true,
      severity: 'low'
    };

    this.logError(errorDetails);
    return errorDetails;
  }

  // Generic error handler
  handleError(code: string, message: string, severity: ErrorDetails['severity'] = 'medium', context?: Record<string, any>): ErrorDetails {
    const errorDetails: ErrorDetails = {
      code,
      message,
      context,
      timestamp: Date.now(),
      recoverable: severity !== 'critical',
      severity
    };

    this.logError(errorDetails);
    return errorDetails;
  }

  // Retry mechanism with exponential backoff
  async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    context?: Record<string, any>
  ): Promise<T> {
    const config: RetryOptions = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      ...options
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        const errorDetails = this.handleError(
          'OPERATION_RETRY_FAILED',
          `Operation failed on attempt ${attempt + 1}`,
          'low',
          {
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            originalError: error instanceof Error ? error.message : String(error),
            ...context
          }
        );

        // Don't retry if condition fails or this is the last attempt
        if (attempt === config.maxRetries ||
            (config.retryCondition && !config.retryCondition(errorDetails))) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelay
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  // Safe async operation wrapper
  async safeAsync<T>(
    operation: () => Promise<T>,
    fallback?: T,
    errorHandler?: (error: ErrorDetails) => void
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      const errorDetails = this.handleError(
        'SAFE_ASYNC_FAILED',
        'Safe async operation failed',
        'low',
        { originalError: error instanceof Error ? error.message : String(error) }
      );

      errorHandler?.(errorDetails);
      return fallback;
    }
  }

  // Get recent errors
  getRecentErrors(count: number = 10): ErrorDetails[] {
    return this.errorLog.slice(-count);
  }

  // Get errors by severity
  getErrorsBySeverity(severity: ErrorDetails['severity']): ErrorDetails[] {
    return this.errorLog.filter(error => error.severity === severity);
  }

  // Clear error log
  clearErrorLog(): void {
    this.errorLog = [];
  }

  // Get error statistics
  getErrorStats(): { total: number; bySeverity: Record<ErrorDetails['severity'], number> } {
    const bySeverity = this.errorLog.reduce((acc, error) => {
      acc[error.severity] = (acc[error.severity] || 0) + 1;
      return acc;
    }, {} as Record<ErrorDetails['severity'], number>);

    return {
      total: this.errorLog.length,
      bySeverity
    };
  }

  private logError(error: ErrorDetails): void {
    this.errorLog.push(error);

    // Maintain log size limit
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error(`[${error.severity.toUpperCase()}] ${error.code}: ${error.message}`, error.context);
    }
  }
}

// Singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Export safeAsync method for convenience
export const safeAsync = errorHandler.safeAsync.bind(errorHandler);

// Utility functions for common error handling patterns
export const safeImageLoad = async (
  loadFunction: () => Promise<string>,
  imagePath: string,
  fallback?: string
): Promise<string | undefined> => {
  return errorHandler.safeAsync(
    loadFunction,
    fallback,
    (error) => {
      // Handle image load errors specifically
      console.warn(`Image load failed for ${imagePath}:`, error.message);
    }
  );
};

export const retryImageOperation = async <T>(
  operation: () => Promise<T>,
  imagePath: string,
  maxRetries: number = 2
): Promise<T> => {
  return errorHandler.withRetry(
    operation,
    {
      maxRetries,
      baseDelay: 500,
      retryCondition: (error) => error.code.includes('IMAGE') || error.code.includes('CACHE')
    },
    { imagePath }
  );
};