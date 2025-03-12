# EPUB to PDF Converter

A Node.js library for converting EPUB files to PDF with support for file paths, buffers, and streams.

## Features

- Convert EPUB files to PDF
- Support for file paths, buffers, and streams for both input and output
- Customizable page format and margins
- Option to include page numbers
- Custom CSS injection
- Font embedding

## Installation

```bash
npm install epub-to-pdf
```

## Usage

### Basic Usage

```typescript
import convertEpubToPdf from 'epub-to-pdf';

// Convert from file to file
await convertEpubToPdf('input.epub', 'output.pdf');

// With options
await convertEpubToPdf('input.epub', 'output.pdf', {
  format: 'A4',
  margin: 0.5,
  includePageNumbers: true,
  customCss: 'body { font-family: Arial; }',
  preserveOriginalCss: true
});
```

### Using Buffers

```typescript
import { convertEpubToPdfBuffer } from 'epub-to-pdf';
import * as fs from 'fs';

// Read EPUB file into buffer
const epubBuffer = fs.readFileSync('input.epub');

// Convert and get PDF as buffer
const pdfBuffer = await convertEpubToPdfBuffer(epubBuffer);

// Write buffer to file
fs.writeFileSync('output.pdf', pdfBuffer);
```

### Using Streams

```typescript
import { convertEpubToPdfStream } from 'epub-to-pdf';
import * as fs from 'fs';

// Create input and output streams
const inputStream = fs.createReadStream('input.epub');
const outputStream = fs.createWriteStream('output.pdf');

// Convert from stream to stream
await convertEpubToPdfStream(inputStream, outputStream);
```

### Using the Class Directly

```typescript
import { EpubToPdf } from 'epub-to-pdf';

// Create converter with options
const converter = new EpubToPdf({
  format: 'Letter',
  margin: 0.75,
  includePageNumbers: true
});

// Convert file to file
await converter.convert('input.epub', 'output.pdf');

// Convert buffer to buffer
const epubBuffer = fs.readFileSync('input.epub');
const pdfBuffer = await converter.convertToBuffer(epubBuffer);

// Convert stream to stream
const inputStream = fs.createReadStream('input.epub');
const outputStream = fs.createWriteStream('output.pdf');
await converter.convertToStream(inputStream, outputStream);
```

## API

### `convertEpubToPdf(input, output, options?)`

Converts an EPUB to PDF.

- `input`: Path to the EPUB file, Buffer containing EPUB data, or Readable stream
- `output`: Path where the PDF will be saved, Writable stream, or null (to return Buffer)
- `options`: Conversion options (optional)
- Returns: Buffer containing the PDF data if output is null, otherwise void

### `convertEpubToPdfBuffer(input, options?)`

Converts an EPUB to PDF and returns the PDF as a Buffer.

- `input`: Path to the EPUB file, Buffer containing EPUB data, or Readable stream
- `options`: Conversion options (optional)
- Returns: Buffer containing the PDF data

### `convertEpubToPdfStream(input, outputStream, options?)`

Converts an EPUB to PDF and writes to a stream.

- `input`: Path to the EPUB file, Buffer containing EPUB data, or Readable stream
- `outputStream`: Writable stream to write the PDF to
- `options`: Conversion options (optional)

### `EpubToPdf` Class

The main class for converting EPUB files to PDF.

#### Constructor

```typescript
new EpubToPdf(options?: EpubToPdfOptions)
```

#### Methods

- `convert(input, output)`: Convert an EPUB to PDF
- `convertToBuffer(input)`: Convert an EPUB to PDF and return as Buffer
- `convertToStream(input, outputStream)`: Convert an EPUB to PDF and write to a stream

### `EpubToPdfOptions` Interface

Options for the EPUB to PDF conversion.

- `format`: Page format for the PDF (default: 'A4')
- `margin`: Page margins in inches (default: 0.5)
- `includePageNumbers`: Whether to include page numbers (default: true)
- `customCss`: Custom CSS to inject into the EPUB
- `preserveOriginalCss`: Whether to preserve the original EPUB CSS (default: true)

## License

MIT
