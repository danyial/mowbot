declare module "ansi-to-html" {
  interface ConvertOptions {
    fg?: string;
    bg?: string;
    newline?: boolean;
    escapeXML?: boolean;
    stream?: boolean;
    colors?: Record<number, string> | string[];
  }

  class Convert {
    constructor(options?: ConvertOptions);
    toHtml(data: string | string[]): string;
  }

  export default Convert;
}
