import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureExtension, imageMime, readScoreFile } from "./fileAccess";

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 80] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 20 40 Td (TABtransporter) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000207 00000 n 
trailer
<< /Root 1 0 R /Size 5 >>
startxref
300
%%EOF
`;

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("score file access", () => {
  it("실제 PDF 파일을 앱 입력 데이터로 읽는다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabtransporter-pdf-"));
    try {
      const filePath = join(directory, "sample-score.pdf");
      await writeFile(filePath, MINIMAL_PDF, "utf8");

      const opened = await readScoreFile(filePath);

      expect(opened.kind).toBe("pdf");
      expect(opened.name).toBe("sample-score.pdf");
      expect(opened.dataUrl).toMatch(/^data:application\/pdf;base64,/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("실제 PNG 이미지 파일을 앱 입력 데이터로 읽는다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tabtransporter-image-"));
    try {
      const filePath = join(directory, "sample-score.png");
      await writeFile(filePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

      const opened = await readScoreFile(filePath);

      expect(opened.kind).toBe("image");
      expect(opened.name).toBe("sample-score.png");
      expect(opened.dataUrl).toMatch(/^data:image\/png;base64,/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("저장 파일 확장자를 보정한다", () => {
    expect(ensureExtension("결과", "pdf")).toBe("결과.pdf");
    expect(ensureExtension("결과.pdf", "pdf")).toBe("결과.pdf");
  });

  it("이미지 MIME 형식을 구분한다", () => {
    expect(imageMime(".jpg")).toBe("image/jpeg");
    expect(imageMime(".webp")).toBe("image/webp");
    expect(imageMime(".png")).toBe("image/png");
  });
});
