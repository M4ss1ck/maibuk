declare module "pagedjs" {
  export interface PreviewerOptions {
    auto?: boolean;
    breakToken?: any;
    settings?: any;
  }

  export class Previewer {
    constructor(options?: PreviewerOptions);
    preview(
      content: HTMLElement,
      stylesheets: Array<{ textContent: string } | string>,
      renderTo: HTMLElement
    ): Promise<any>;
    registerHandlers(handlers: any[]): void;
  }

  export class Polisher {
    constructor(options?: any);
  }

  export class Chunker {
    constructor(content: HTMLElement, renderTo: HTMLElement, options?: any);
  }
}
