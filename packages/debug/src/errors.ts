/**
 * @packageDocumentation
 */

/** Thrown when {@link attachInspector} is used outside development without override. */
export class InspectorDisabledError extends Error {
  override readonly name = 'InspectorDisabledError';

  constructor(message: string) {
    super(message);
  }
}
