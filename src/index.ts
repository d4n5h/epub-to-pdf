import AdmZip from 'adm-zip';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as cheerio from 'cheerio';
import * as xml2js from 'xml2js';
import * as puppeteer from 'puppeteer';
import { dir as tmpPromise } from 'tmp-promise';
import { Readable, Writable } from 'stream';
import { promisify } from 'util';
import { pipeline } from 'stream';

const pipelineAsync = promisify(pipeline);

/**
 * Options for the EPUB to PDF conversion
 */
export interface EpubToPdfOptions {
  /**
   * Page format for the PDF (default: A4)
   */
  format?: puppeteer.PaperFormat;
  
  /**
   * Page margins in inches (default: 0.5)
   */
  margin?: number;
  
  /**
   * Whether to include page numbers (default: true)
   */
  includePageNumbers?: boolean;
  
  /**
   * Custom CSS to inject into the EPUB
   */
  customCss?: string;
  
  /**
   * Whether to preserve the original EPUB CSS (default: true)
   */
  preserveOriginalCss?: boolean;
}

/**
 * Input types for EPUB conversion
 */
export type EpubInput = string | Buffer | Readable;

/**
 * Output types for PDF conversion
 */
export type PdfOutput = string | Writable | null;

/**
 * Class for converting EPUB files to PDF
 */
export class EpubToPdf {
  private options: Required<EpubToPdfOptions>;
  
  /**
   * Create a new EpubToPdf converter
   * @param options Options for the conversion
   */
  constructor(options: EpubToPdfOptions = {}) {
    this.options = {
      format: options.format || 'A4',
      margin: options.margin !== undefined ? options.margin : 0.5,
      includePageNumbers: options.includePageNumbers !== undefined ? options.includePageNumbers : true,
      customCss: options.customCss || '',
      preserveOriginalCss: options.preserveOriginalCss !== undefined ? options.preserveOriginalCss : true,
    };
  }
  
  /**
   * Convert an EPUB to PDF
   * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
   * @param output Path where the PDF will be saved, Writable stream, or null (to return Buffer)
   * @returns Buffer containing the PDF data if output is null, otherwise void
   */
  public async convert(input: EpubInput, output: PdfOutput): Promise<Buffer | void> {
    // Create a temporary directory for extraction
    const tempDir = await this.createTempDirectory();
    
    try {
      // Extract the EPUB file
      await this.extractEpub(input, tempDir.path);
      
      // Process the EPUB content
      const epubData = await this.processEpub(tempDir.path);
      
      // Generate the PDF
      return await this.generatePdf(epubData, output);
      
    } finally {
      // Clean up the temporary directory
      await tempDir.cleanup();
    }
  }
  
  /**
   * Create a temporary directory for EPUB extraction
   */
  private async createTempDirectory() {
    return tmpPromise({ unsafeCleanup: true });
  }
  
  /**
   * Extract the EPUB to a directory
   * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
   * @param extractPath Path where the EPUB will be extracted
   */
  private async extractEpub(input: EpubInput, extractPath: string): Promise<void> {
    let zip: AdmZip;
    
    if (typeof input === 'string') {
      // Input is a file path
      zip = new AdmZip(input);
    } else if (Buffer.isBuffer(input)) {
      // Input is a Buffer
      zip = new AdmZip(input);
    } else {
      // Input is a Readable stream
      const chunks: Buffer[] = [];
      for await (const chunk of input) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      zip = new AdmZip(buffer);
    }
    
    zip.extractAllTo(extractPath, true);
  }
  
  /**
   * Process the extracted EPUB content
   * @param extractPath Path where the EPUB was extracted
   */
  private async processEpub(extractPath: string): Promise<EpubData> {
    // Find the container.xml file
    const containerPath = path.join(extractPath, 'META-INF', 'container.xml');
    
    if (!fs.existsSync(containerPath)) {
      throw new Error('Invalid EPUB: container.xml not found');
    }
    
    // Parse container.xml to find the OPF file
    const containerXml = await fs.readFile(containerPath, 'utf-8');
    const containerData = await xml2js.parseStringPromise(containerXml);
    
    const rootfilePath = containerData.container.rootfiles[0].rootfile[0].$['full-path'];
    const opfPath = path.join(extractPath, rootfilePath);
    
    if (!fs.existsSync(opfPath)) {
      throw new Error(`Invalid EPUB: OPF file not found at ${rootfilePath}`);
    }
    
    // Parse the OPF file
    const opfDir = path.dirname(opfPath);
    const opfXml = await fs.readFile(opfPath, 'utf-8');
    const opfData = await xml2js.parseStringPromise(opfXml);
    
    // Get metadata
    const metadata = this.extractMetadata(opfData);
    
    // Get manifest items
    const manifest = this.extractManifest(opfData, opfDir);
    
    // Get spine (reading order)
    const spine = this.extractSpine(opfData, manifest);
    
    // Process CSS files
    const cssFiles = manifest.filter(item => item.mediaType.includes('css'));
    const cssContent = await this.processCssFiles(cssFiles);
    
    // Process font files
    const fontFiles = manifest.filter(item => 
      item.mediaType.includes('font') || 
      item.mediaType.includes('opentype') || 
      item.href.endsWith('.ttf') || 
      item.href.endsWith('.otf')
    );
    
    return {
      metadata,
      spine,
      manifest,
      cssContent,
      fontFiles,
      basePath: opfDir
    };
  }
  
  /**
   * Extract metadata from the OPF data
   * @param opfData Parsed OPF data
   */
  private extractMetadata(opfData: any): EpubMetadata {
    const metadataNode = opfData.package.metadata[0];
    
    const title = metadataNode['dc:title'] ? metadataNode['dc:title'][0] : 'Untitled';
    const creator = metadataNode['dc:creator'] ? metadataNode['dc:creator'][0] : 'Unknown Author';
    const language = metadataNode['dc:language'] ? metadataNode['dc:language'][0] : 'en';
    
    return { title, creator, language };
  }
  
  /**
   * Extract manifest items from the OPF data
   * @param opfData Parsed OPF data
   * @param opfDir Directory containing the OPF file
   */
  private extractManifest(opfData: any, opfDir: string): EpubManifestItem[] {
    const manifestNode = opfData.package.manifest[0];
    
    return manifestNode.item.map((item: any) => {
      const id = item.$.id;
      const href = item.$.href;
      const mediaType = item.$['media-type'];
      const properties = item.$.properties || '';
      
      return {
        id,
        href,
        mediaType,
        properties,
        path: path.join(opfDir, href)
      };
    });
  }
  
  /**
   * Extract spine items (reading order) from the OPF data
   * @param opfData Parsed OPF data
   * @param manifest Manifest items
   */
  private extractSpine(opfData: any, manifest: EpubManifestItem[]): EpubSpineItem[] {
    const spineNode = opfData.package.spine[0];
    
    return spineNode.itemref.map((itemref: any) => {
      const idref = itemref.$.idref;
      const linear = itemref.$.linear !== 'no';
      
      const manifestItem = manifest.find(item => item.id === idref);
      
      if (!manifestItem) {
        throw new Error(`Invalid EPUB: spine item ${idref} not found in manifest`);
      }
      
      return {
        idref,
        linear,
        href: manifestItem.href,
        path: manifestItem.path
      };
    });
  }
  
  /**
   * Process CSS files from the EPUB
   * @param cssFiles CSS manifest items
   */
  private async processCssFiles(cssFiles: EpubManifestItem[]): Promise<string> {
    let combinedCss = '';
    
    if (this.options.preserveOriginalCss) {
      for (const cssFile of cssFiles) {
        if (fs.existsSync(cssFile.path)) {
          const css = await fs.readFile(cssFile.path, 'utf-8');
          combinedCss += css + '\n';
        }
      }
    }
    
    // Add custom CSS
    if (this.options.customCss) {
      combinedCss += this.options.customCss;
    }
    
    // Add PDF-specific CSS
    combinedCss += `
      @page {
        margin: ${this.options.margin}in;
      }
      body {
        margin: 0;
        padding: 0;
      }
    `;
    
    return combinedCss;
  }
  
  /**
   * Generate a PDF from the processed EPUB data
   * @param epubData Processed EPUB data
   * @param output Path where the PDF will be saved, Writable stream, or null (to return Buffer)
   * @returns Buffer containing the PDF data if output is null, otherwise void
   */
  private async generatePdf(epubData: EpubData, output: PdfOutput): Promise<Buffer | void> {
    // Create a temporary HTML file that combines all content
    const { path: tempHtmlPath, cleanup: cleanupHtml } = await this.createCombinedHtml(epubData);
    
    try {
      // Launch Puppeteer
      const browser = await puppeteer.launch({ headless: true });
      
      try {
        const page = await browser.newPage();
        
        // Set the page size
        await page.setViewport({ width: 1240, height: 1754 });
        
        // Navigate to the HTML file
        await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle2' });
        
        // PDF options
        const pdfOptions: puppeteer.PDFOptions = {
          format: this.options.format,
          margin: {
            top: `${this.options.margin}in`,
            right: `${this.options.margin}in`,
            bottom: `${this.options.margin}in`,
            left: `${this.options.margin}in`
          },
          printBackground: true,
          displayHeaderFooter: this.options.includePageNumbers,
          headerTemplate: '<span></span>',
          footerTemplate: this.options.includePageNumbers 
            ? '<div style="width: 100%; text-align: center; font-size: 10px; color: #999;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
            : '<span></span>'
        };
        
        if (output === null) {
          // Return PDF as Buffer
          return await page.pdf(pdfOptions) as Buffer;
        } else if (typeof output === 'string') {
          // Write to file path
          pdfOptions.path = output;
          await page.pdf(pdfOptions);
        } else {
          // Write to stream
          const pdfBuffer = await page.pdf(pdfOptions) as Buffer;
          const bufferStream = new Readable();
          bufferStream.push(pdfBuffer);
          bufferStream.push(null);
          await pipelineAsync(bufferStream, output);
        }
      } finally {
        await browser.close();
      }
    } finally {
      await cleanupHtml();
    }
  }
  
  /**
   * Create a combined HTML file from all EPUB content
   * @param epubData Processed EPUB data
   */
  private async createCombinedHtml(epubData: EpubData): Promise<{ path: string, cleanup: () => Promise<void> }> {
    const { path: tempDir, cleanup } = await tmpPromise({ unsafeCleanup: true });
    
    // Create a directory for assets
    const assetsDir = path.join(tempDir, 'assets');
    await fs.mkdir(assetsDir);
    
    // Copy all font files
    for (const fontFile of epubData.fontFiles) {
      const fontFileName = path.basename(fontFile.href);
      const fontDestPath = path.join(assetsDir, fontFileName);
      await fs.copy(fontFile.path, fontDestPath);
    }
    
    // Copy all image files
    const imageFiles = epubData.manifest.filter(item => item.mediaType.startsWith('image/'));
    for (const imageFile of imageFiles) {
      const imageFileName = path.basename(imageFile.href);
      const imageDestPath = path.join(assetsDir, imageFileName);
      await fs.copy(imageFile.path, imageDestPath);
    }
    
    // Create the combined HTML
    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${epubData.metadata.title}</title>
  <style>
    ${this.processFontPaths(epubData.cssContent, 'assets/')}
  </style>
</head>
<body>`;
    
    // Add each content file
    for (const spineItem of epubData.spine) {
      if (spineItem.linear && fs.existsSync(spineItem.path)) {
        const content = await fs.readFile(spineItem.path, 'utf-8');
        const $ = cheerio.load(content);
        
        // Fix image paths
        $('img').each((_: number, img: cheerio.Element) => {
          const src = $(img).attr('src');
          if (src) {
            const imgName = path.basename(src);
            $(img).attr('src', `assets/${imgName}`);
          }
        });
        
        // Extract the body content
        const bodyContent = $('body').html() || '';
        
        // Add a page break before each new section (except the first)
        if (html.includes('</section>')) {
          html += '<div class="page-break"></div>';
        }
        
        html += bodyContent;
      }
    }
    
    html += `</body></html>`;
    
    // Add page break CSS
    html = html.replace('</style>', `
  .page-break {
    page-break-after: always;
  }
</style>`);
    
    // Fix image paths in the combined HTML
    const $ = cheerio.load(html);
    $('img').each((_: number, img: cheerio.Element) => {
      const src = $(img).attr('src');
      if (src && !src.startsWith('assets/')) {
        const imgName = path.basename(src);
        $(img).attr('src', `assets/${imgName}`);
      }
    });
    
    html = $.html();
    
    // Write the combined HTML to a file
    const htmlPath = path.join(tempDir, 'combined.html');
    await fs.writeFile(htmlPath, html);
    
    return {
      path: htmlPath,
      cleanup
    };
  }
  
  /**
   * Process font paths in CSS to point to the correct location
   * @param css CSS content
   * @param fontDir Directory containing the fonts
   */
  private processFontPaths(css: string, fontDir: string): string {
    // Replace font paths in @font-face rules
    return css.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, fontPath) => {
      const fontName = path.basename(fontPath);
      return `url('${fontDir}${fontName}')`;
    });
  }

  /**
   * Convert an EPUB to PDF and return the PDF as a Buffer
   * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
   * @param options Options for the conversion
   * @returns Buffer containing the PDF data
   */
  public async convertToBuffer(input: EpubInput): Promise<Buffer> {
    return await this.convert(input, null) as Buffer;
  }

  /**
   * Convert an EPUB to PDF and write to a stream
   * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
   * @param outputStream Writable stream to write the PDF to
   */
  public async convertToStream(input: EpubInput, outputStream: Writable): Promise<void> {
    await this.convert(input, outputStream);
  }
}

/**
 * Interface for EPUB metadata
 */
interface EpubMetadata {
  title: string;
  creator: string;
  language: string;
}

/**
 * Interface for EPUB manifest item
 */
interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
  path: string;
}

/**
 * Interface for EPUB spine item
 */
interface EpubSpineItem {
  idref: string;
  linear: boolean;
  href: string;
  path: string;
}

/**
 * Interface for processed EPUB data
 */
interface EpubData {
  metadata: EpubMetadata;
  spine: EpubSpineItem[];
  manifest: EpubManifestItem[];
  cssContent: string;
  fontFiles: EpubManifestItem[];
  basePath: string;
}

/**
 * Convert an EPUB to PDF
 * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
 * @param output Path where the PDF will be saved, Writable stream, or null (to return Buffer)
 * @param options Options for the conversion
 * @returns Buffer containing the PDF data if output is null, otherwise void
 */
export default async function convertEpubToPdf(
  input: EpubInput, 
  output: PdfOutput, 
  options: EpubToPdfOptions = {}
): Promise<Buffer | void> {
  const converter = new EpubToPdf(options);
  return await converter.convert(input, output);
}

/**
 * Convert an EPUB to PDF and return the PDF as a Buffer
 * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
 * @param options Options for the conversion
 * @returns Buffer containing the PDF data
 */
export async function convertEpubToPdfBuffer(
  input: EpubInput,
  options: EpubToPdfOptions = {}
): Promise<Buffer> {
  const converter = new EpubToPdf(options);
  return await converter.convertToBuffer(input);
}

/**
 * Convert an EPUB to PDF and write to a stream
 * @param input Path to the EPUB file, Buffer containing EPUB data, or Readable stream
 * @param outputStream Writable stream to write the PDF to
 * @param options Options for the conversion
 */
export async function convertEpubToPdfStream(
  input: EpubInput,
  outputStream: Writable,
  options: EpubToPdfOptions = {}
): Promise<void> {
  const converter = new EpubToPdf(options);
  await converter.convertToStream(input, outputStream);
} 