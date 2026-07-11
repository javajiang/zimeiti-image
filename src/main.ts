import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";

const VIEW_TYPE_ZIMEITI = "zimeiti-image-guide";
const API_BASE_URL = "https://lingshuzhisuan.cn";
const IMAGE_API_BASE_URL = "https://lingshuzhisuan.cn";
const API_MODEL = "gemini-2.5-pro";
const STYLE_LIBRARY_FOLDER = "图片风格库";
const IMAGE_OUTPUT_FOLDER = "生成图片";
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif"]);
const IMAGE_STYLE_START = "[IMAGE_STYLE_START]";
const IMAGE_STYLE_END = "[IMAGE_STYLE_END]";

interface ZimeitiSettings {
  apiKey: string;
  styleLibraryFolder: string;
  outputFolder: string;
}

interface ImageSingleResult {
  path: string;
  name: string;
  markdown: string;
}

interface ImageBatchDraft {
  styleName: string;
  items: ImageSingleResult[];
}

interface ImageFinalStyleNote {
  styleName: string;
  markdown: string;
}

interface ImageGenerationOptions {
  prompt: string;
  styleEnabled: boolean;
  stylePath: TFile | null;
  outputFolder: string;
  imageCount: number;
  aspectRatio: string;
}

interface GeneratedImageResult {
  path: string;
  mimeType: string;
}

const DEFAULT_SETTINGS: ZimeitiSettings = {
  apiKey: "",
  styleLibraryFolder: "",
  outputFolder: "",
};

export default class ZimeitiImagePlugin extends Plugin {
  settings: ZimeitiSettings = DEFAULT_SETTINGS;

  getStyleLibraryFolder() {
    return this.settings.styleLibraryFolder.trim() || STYLE_LIBRARY_FOLDER;
  }

  getOutputFolder() {
    return this.settings.outputFolder.trim() || IMAGE_OUTPUT_FOLDER;
  }

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_ZIMEITI, (leaf) => new ZimeitiGuideView(leaf));

    this.addRibbonIcon("image", "Open Zimeiti Image guide", async () => this.activateGuide());
    this.addRibbonIcon("book-open", "Open image documentation", async () => {
      await this.openDocumentation();
    });

    this.addCommand({
      id: "open-zimeiti-image-guide",
      name: "Open image guide",
      callback: async () => this.activateGuide(),
    });
    this.addCommand({
      id: "open-zimeiti-image-docs",
      name: "打开图片插件说明书",
      callback: async () => this.openDocumentation(),
    });

    this.addCommand({
      id: "image-distill-current",
      name: "图片风格蒸馏：当前图片",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isImageFile(file)) return void new Notice("请先打开一张图片。");
        const styleName = await this.promptStyleName(file.basename);
        if (styleName === null) return;
        await this.distillSingleImage(file, styleName);
      },
    });

    this.addCommand({
      id: "image-distill-multiple",
      name: "图片风格蒸馏：多张图片",
      callback: async () => {
        const files = await this.promptImageSelection();
        if (files.length === 0) return;
        const styleName = await this.promptStyleName("未命名图片风格");
        if (styleName === null) return;
        await this.distillMultipleImages(files, styleName);
      },
    });

    this.addCommand({
      id: "image-generate-from-folder",
      name: "生成图片",
      callback: async () => {
        const folder = this.getActiveFolder();
        if (!folder) return void new Notice("请先在文件夹中选中一个目录。");
        await this.handleGenerateImage(folder);
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && this.isImageFile(file)) {
          menu.addItem((item) =>
            item.setTitle("图片风格蒸馏").setIcon("image").onClick(async () => {
              const styleName = await this.promptStyleName(file.basename);
              if (styleName === null) return;
              await this.distillSingleImage(file, styleName);
            }),
          );
        }
        if (file instanceof TFolder) {
          menu.addItem((item) =>
            item.setTitle("生成图片").setIcon("image-plus").onClick(async () => {
              await this.handleGenerateImage(file);
            }),
          );
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const images = files.filter((file) => file instanceof TFile && this.isImageFile(file)) as TFile[];
        if (images.length === 0) return;
        menu.addItem((item) =>
          item.setTitle("图片风格蒸馏").setIcon("image").onClick(async () => {
            const styleName = await this.promptStyleName("未命名图片风格");
            if (styleName === null) return;
            await this.distillMultipleImages(images, styleName);
          }),
        );
      }),
    );

    this.addSettingTab(new ZimeitiSettingTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ZIMEITI);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateGuide() {
    let leaf: WorkspaceLeaf | null | undefined = this.app.workspace.getLeavesOfType(VIEW_TYPE_ZIMEITI)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
      await leaf?.setViewState({ type: VIEW_TYPE_ZIMEITI, active: true });
    }
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }

  async openDocumentation() {
    await this.openOrCreateNote(
      "图片插件说明.md",
      [
        "# Zimeiti Image 说明书",
        "",
        "面向电商从业者的 Obsidian 插件，用于收集竞品电商图片、提取风格，并生成新的商品主图或详情图。",
        "",
        "## 适用人群",
        "- 电商运营",
        "- 视觉设计师",
        "- 商品详情页制作人员",
        "- 需要分析竞品主图/详情图的人",
        "",
        "## 核心能力",
        "- 单张图片风格蒸馏",
        "- 多张图片风格蒸馏",
        "- 基于风格生成图片",
        "- 风格结果保存到 `图片风格库`",
        "- 生成结果保存到 `生成图片`",
      ].join("\n"),
    );
  }

  async openOrCreateNote(path: string, content: string) {
    const normalized = path.replace(/^\/+/, "");
    let file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) {
      await this.ensureOutputNote(normalized, content);
      file = this.app.vault.getAbstractFileByPath(normalized);
    }
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    }
  }

  isImageFile(file: TFile) {
    return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
  }

  async ensureFileExists(file: TFile): Promise<boolean> {
    return await this.app.vault.adapter.exists(file.path);
  }

  async fileToDataUrl(file: TFile): Promise<string> {
    const exists = await this.ensureFileExists(file);
    if (!exists) {
      throw new Error(`文件不存在：${file.path}`);
    }
    const arrayBuffer = await this.app.vault.adapter.readBinary(file.path);
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const mime = this.guessImageMime(file.extension);
    return `data:${mime};base64,${base64}`;
  }

  guessImageMime(extension: string) {
    switch (extension.toLowerCase()) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "gif":
        return "image/gif";
      case "bmp":
        return "image/bmp";
      case "tif":
      case "tiff":
        return "image/tiff";
      case "avif":
        return "image/avif";
      default:
        return "image/png";
    }
  }

  async promptStyleName(defaultName: string): Promise<string | null> {
    return await new Promise((resolve) => new StyleNameModal(this.app, defaultName, "请输入风格名称", resolve).open());
  }

  async promptImageSelection(): Promise<TFile[]> {
    return await new Promise((resolve) => new ImageSelectionModal(this.app, resolve).open());
  }

  getAllImageFiles() {
    return this.app.vault.getFiles().filter((file) => file instanceof TFile && this.isImageFile(file)) as TFile[];
  }

  getActiveFolder(): TFolder | null {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    const parent = this.app.vault.getAbstractFileByPath(file.parent?.path ?? "");
    return parent instanceof TFolder ? parent : null;
  }

  async distillSingleImage(file: TFile, styleName: string): Promise<ImageSingleResult> {
    new Notice("图片蒸馏处理中...");
    const exists = await this.ensureFileExists(file);
    if (!exists) {
      new Notice(`已跳过不存在的图片：${file.basename}`);
      return { path: file.path, name: file.basename, markdown: "" };
    }
    const dataUrl = await this.fileToDataUrl(file);
    const markdown = await this.requestImageDistillation(file.basename, file.extension, dataUrl);
    const outputPath = `${this.getStyleLibraryFolder()}/${this.normalizeFileName(styleName || file.basename)}.md`;
    await this.ensureOutputNote(outputPath, markdown);
    new Notice("图片风格蒸馏已保存。");
    return { path: file.path, name: file.basename, markdown };
  }

  async distillMultipleImages(files: TFile[], styleName: string) {
    new Notice("图片蒸馏处理中...");
    const validFiles: TFile[] = [];
    const missingFiles: TFile[] = [];
    for (const file of files) {
      if (await this.ensureFileExists(file)) validFiles.push(file);
      else missingFiles.push(file);
    }
    if (missingFiles.length > 0) {
      new Notice(`已跳过 ${missingFiles.length} 张不存在的图片。`);
    }
    if (validFiles.length === 0) {
      new Notice("没有可用的图片文件。");
      return;
    }
    const items: ImageSingleResult[] = [];
    for (const file of validFiles) {
      const dataUrl = await this.fileToDataUrl(file);
      const markdown = await this.requestImageDistillation(file.basename, file.extension, dataUrl);
      items.push({ path: file.path, name: file.basename, markdown });
    }
    const final = await this.composeImageFinalStyle({ styleName, items });
    await this.ensureOutputNote(`${this.getStyleLibraryFolder()}/${this.normalizeFileName(styleName)}.md`, final.markdown);
    new Notice("图片风格蒸馏已保存。");
  }

  async handleGenerateImage(folder: TFolder) {
    const options = await this.promptImageGeneration(folder.path);
    if (!options) return;
    await this.generateImagesFromFolder(folder.path, options);
  }

  async promptImageGeneration(defaultFolder: string): Promise<ImageGenerationOptions | null> {
    const styleFiles = this.app.vault.getMarkdownFiles()
      .filter((item) => item.path.startsWith(`${this.getStyleLibraryFolder()}/`))
      .sort((a, b) => a.basename.localeCompare(b.basename));
    return await new Promise((resolve) => new ImageGenerationModal(this.app, defaultFolder, styleFiles, resolve).open());
  }

  async generateImagesFromFolder(folderPath: string, options: ImageGenerationOptions) {
    new Notice("图片生成处理中...");
    const sourceImages = this.app.vault.getFiles().filter((file) => file instanceof TFile && file.path.startsWith(`${folderPath}/`) && this.isImageFile(file)) as TFile[];
    const rawStyleContent = options.styleEnabled && options.stylePath ? await this.app.vault.cachedRead(options.stylePath) : "";
    const styleContent = this.extractImageStyleBlock(rawStyleContent);
    const outputFolder = (options.outputFolder || this.getOutputFolder()).replace(/^\/+/, "");
    const generated = await this.runImageGeneration({
      prompt: options.prompt,
      styleContent,
      outputFolder,
      imageCount: options.imageCount,
      aspectRatio: options.aspectRatio,
      referenceImages: sourceImages,
    });
    new Notice("图片生成已保存。");
  }

  async runImageGeneration(params: {
    prompt: string;
    styleContent: string;
    outputFolder: string;
    imageCount: number;
    aspectRatio: string;
    referenceImages: TFile[];
  }): Promise<GeneratedImageResult[]> {
    if (!this.settings.apiKey) throw new Error("请先在插件设置中填写 API Key。");
    const prompt = this.composeGenerationPrompt(params.prompt, params.styleContent);
    const size = this.mapImageSize(params.aspectRatio);
    const results: GeneratedImageResult[] = [];
    for (let i = 0; i < Math.max(1, params.imageCount); i++) {
      const response = await fetch(`${IMAGE_API_BASE_URL}/v1/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt,
          size,
          quality: "auto",
          format: "jpeg",
          n: 1,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json() as any;
      const item = data?.data?.[0];
      const b64 = String(item?.b64_json || "").trim();
      const mimeType = String(item?.mime_type || "image/png");
      if (!b64) throw new Error("图片生成接口没有返回 b64_json。");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const suffix = this.extensionFromMimeType(mimeType);
      const imagePath = `${params.outputFolder}/生成图片-${String(i + 1).padStart(2, "0")}${suffix}`;
      await this.ensureOutputBinary(imagePath, bytes.buffer);
      results.push({ path: imagePath, mimeType });
      if (i < Math.max(1, params.imageCount) - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 30000));
      }
    }
    return results;
  }

  extractImageStyleBlock(markdown: string) {
    const content = String(markdown || "").trim();
    if (!content) return "";
    const start = content.indexOf(IMAGE_STYLE_START);
    const end = content.indexOf(IMAGE_STYLE_END);
    if (start !== -1 && end !== -1 && end > start) {
      return content.slice(start + IMAGE_STYLE_START.length, end).trim();
    }
    const headingPattern = /^(?:#{1,6}\s*|[一二三四五六七八九十]+[、.]\s*)生图专用风格[^\n]*$/m;
    const match = headingPattern.exec(content);
    if (match && match.index !== undefined) {
      const rest = content.slice(match.index);
      const nextHeadingPattern = /\n(?=(?:#{1,6}\s*|[一二三四五六七八九十]+[、.]\s*)[^ \n])/g;
      let endIndex = rest.length;
      let foundFirst = false;
      for (const headingMatch of rest.matchAll(nextHeadingPattern)) {
        const idx = headingMatch.index ?? -1;
        if (idx <= 0) continue;
        if (!foundFirst) {
          foundFirst = true;
          continue;
        }
        endIndex = idx;
        break;
      }
      return rest.slice(0, endIndex).trim();
    }
    return content;
  }

  composeGenerationPrompt(userPrompt: string, styleContent: string) {
    const parts = [
      "你是专业的电商图片生成助手，请根据以下内容生成一张高质量图片。",
      "",
      "生成要求：",
      "- 必须满足用户需求。",
      "- 如果提供了风格内容，必须严格遵循其中的主体设定、材质表现、色彩关系、光线方式、构图方式、场景设定、氛围描述、可复用规则和禁忌要求。",
      "- 如果没有提供风格内容，就直接按照用户需求生成。",
      "- 不要输出解释、分析、标题、编号、Markdown。",
      "",
      "风格内容：",
      styleContent.trim() || "无",
      "",
      "用户需求：",
      userPrompt.trim(),
    ];
    return parts.join("\n");
  }

  mapImageSize(aspectRatio: string) {
    switch (aspectRatio.trim()) {
      case "1:1":
        return "1024x1024";
      case "3:2":
        return "1536x1024";
      case "2:3":
        return "1024x1536";
      case "16:9":
        return "2048x1152";
      case "9:16":
        return "2160x3840";
      default:
        return "1024x1024";
    }
  }

  extensionFromMimeType(mimeType: string) {
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
    if (mimeType.includes("webp")) return ".webp";
    return ".png";
  }

  async ensureOutputBinary(path: string, data: ArrayBuffer) {
    const normalized = path.replace(/^\/+/, "");
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return void await this.app.vault.modifyBinary(existing, data);
    await this.app.vault.createBinary(normalized, data);
  }

  async requestImageDistillation(imageName: string, extension: string, dataUrl: string): Promise<string> {
    const prompt = [
      `请分析这张电商图片，文件名是《${imageName}》。`,
      "请输出为结构化 Markdown，必须包含这些部分：",
      "1. 生图专用风格（必须放在固定标记中）",
      "2. 完整风格分析",
      "",
      "要求：",
      "1. 在输出完整风格分析的同时，请额外输出一个“生图专用风格”部分，供后续图片生成直接使用。",
      "2. 生图专用风格只保留以下字段：",
      "- 商品主体",
      "- 构图方式",
      "- 视角",
      "- 光线风格",
      "- 色彩风格",
      "- 材质 / 质感",
      "- 场景环境",
      "- 可复用规则",
      "3. 不要输出“禁忌 / 不适合点”。",
      "4. 每个字段内容必须压缩表达，不超过100字。",
      "5. 生图专用风格必须适合直接提供给后续图片生成使用，描述应明确、具体、可执行，不要写分析性废话。",
      "6. 场景环境只写产品所在环境或语境，不要写图片类型。",
      "7. 生图专用风格必须严格包裹在以下标记之间，标记必须原样输出，不要改写：",
      IMAGE_STYLE_START,
      "8. 生图专用风格标记内只写字段内容，不要加额外说明。",
      IMAGE_STYLE_END,
      "9. 输出格式必须严格如下：",
      "",
      `${IMAGE_STYLE_START}`,
      "- 商品主体：",
      "- 构图方式：",
      "- 视角：",
      "- 光线风格：",
      "- 色彩风格：",
      "- 材质 / 质感：",
      "- 场景环境：",
      "- 可复用规则：",
      `${IMAGE_STYLE_END}`,
      "",
      "## 完整风格分析",
      "完整风格分析中必须包含这些部分：",
      "1. 商品主体",
      "2. 构图方式",
      "3. 视角",
      "4. 光线风格",
      "5. 色彩风格",
      "6. 材质 / 质感",
      "7. 场景环境",
      "8. 电商用途",
      "9. 视觉重点",
      "10. 可复用规则",
      "",
    ].join("\n");
    return this.runVisionCompletion(
      [{
        role: "user",
        parts: [
          { inline_data: { mime_type: this.guessImageMime(extension), data: dataUrl.split(",")[1] ?? "" } },
          { text: prompt },
        ],
      }],
      `# ${imageName} 图片风格`
    );
  }

  async composeImageFinalStyle(batch: ImageBatchDraft): Promise<ImageFinalStyleNote> {
    const combined = batch.items.map((item) => `## ${item.name}\n\n${item.markdown}`).join("\n\n");
    const markdown = await this.runVisionCompletion(
      [{
        role: "user",
        parts: [{
          text: [
            "请将以下单图结果整理成统一图片风格稿。",
            "最终输出必须继续保留固定标记的“生图专用风格”块，格式原样如下：",
            IMAGE_STYLE_START,
            "（只写压缩后的字段内容）",
            IMAGE_STYLE_END,
            "",
            "请在标记外继续保留完整风格分析。",
            "",
            combined,
          ].join("\n"),
        }],
      }],
      `# ${batch.styleName} 图片风格蒸馏`,
    );
    return { styleName: batch.styleName, markdown };
  }

  async runVisionCompletion(contents: Array<{ role: "user"; parts: Array<{ inline_data?: { mime_type: string; data: string }; text?: string }> }>, fallbackTitle: string): Promise<string> {
    if (!this.settings.apiKey) throw new Error("请先在插件设置中填写 API Key。");
    try {
      const response = await fetch(`${API_BASE_URL}/v1beta/models/${API_MODEL}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 16000 },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json() as any;
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("").trim();
      if (!text) throw new Error("模型没有返回有效文本。");
      return text;
    } catch (error) {
      console.error("图片蒸馏失败", error);
      const detail = error instanceof Error ? error.message : String(error);
      new Notice(`图片蒸馏失败：${detail}`);
      return `${fallbackTitle}\n\n图片蒸馏失败：${detail}`;
    }
  }

  async ensureOutputNote(path: string, content: string) {
    const normalized = path.replace(/^\/+/, "");
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent && !this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return void await this.app.vault.modify(existing, content);
    await this.app.vault.create(normalized, content);
  }

  normalizeFileName(name: string) {
    return name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-");
  }
}

class ZimeitiGuideView extends ItemView {
  getViewType() { return VIEW_TYPE_ZIMEITI; }
  getDisplayText() { return "Zimeiti Image"; }
  getIcon() { return "image"; }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Zimeiti Image" });
    contentEl.createEl("p", { text: "图片插件：只负责图片理解与图片风格蒸馏。", cls: "zimeiti-muted" });
  }
}

class ZimeitiSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ZimeitiImagePlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("API Key").addText((text) => text.setValue(this.plugin.settings.apiKey).onChange(async (value) => { this.plugin.settings.apiKey = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("风格目录").setDesc(`留空使用默认值“${STYLE_LIBRARY_FOLDER}”。`).addText((text) => text.setPlaceholder(STYLE_LIBRARY_FOLDER).setValue(this.plugin.settings.styleLibraryFolder).onChange(async (value) => { this.plugin.settings.styleLibraryFolder = value.trim(); await this.plugin.saveSettings(); }));
  }
}

class StyleNameModal extends Modal {
  private value = "";
  constructor(app: App, private defaultName: string, private placeholder: string, private onSubmit: (value: string | null) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const wrapper = contentEl.createDiv({ cls: "zimeiti-style-name-modal" });
    const input = wrapper.createEl("input", {
      type: "text",
      value: "",
      placeholder: this.placeholder,
      cls: "zimeiti-style-name-input",
    });

    input.addEventListener("input", () => {
      this.value = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancel();
      }
    });

    const footer = wrapper.createDiv({ cls: "zimeiti-style-name-actions" });
    const cancelBtn = footer.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.cancel();
    const okBtn = footer.createEl("button", { text: "确认" });
    okBtn.onclick = () => this.submit();

    window.setTimeout(() => input.focus(), 0);
  }

  private submit() {
    const value = this.value.trim() || this.defaultName.trim();
    this.close();
    this.onSubmit(value || null);
  }

  private cancel() {
    this.close();
    this.onSubmit(null);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ImageGenerationModal extends Modal {
  private promptValue = "";
  private outputFolderValue = "";
  private imageCountValue = 1;
  private aspectRatioValue = "9:16";
  private styleEnabledValue = false;
  private stylePathValue: TFile | null = null;
  private styleSelect!: HTMLSelectElement;

  constructor(
    app: App,
    private defaultFolder: string,
    private styleFiles: TFile[],
    private onSubmit: (value: ImageGenerationOptions | null) => void,
  ) {
    super(app);
    this.outputFolderValue = defaultFolder;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText("生成图片");

    const form = contentEl.createDiv({ cls: "zimeiti-image-generate-form" });
    this.createTextAreaField(form, "需求", "请输入图片生成需求", (input) => {
      this.promptValue = input.value;
      input.addEventListener("input", () => {
        this.promptValue = input.value;
      });
    });

    const styleField = form.createDiv({ cls: "zimeiti-image-field" });
    const styleToggle = styleField.createDiv({ cls: "zimeiti-image-style-toggle" });
    const styleLabel = styleToggle.createDiv({ cls: "zimeiti-image-style-label" });
    styleLabel.createEl("span", { text: "风格" });
    const checkbox = styleLabel.createEl("input", { type: "checkbox" });
    checkbox.checked = false;
    checkbox.addEventListener("change", () => {
      this.styleEnabledValue = checkbox.checked;
      this.styleSelect.disabled = !checkbox.checked;
      if (!checkbox.checked) this.stylePathValue = null;
    });
    this.styleSelect = styleField.createEl("select");
    this.styleSelect.createEl("option", { text: "未选择风格", value: "" });
    for (const file of this.styleFiles) {
      this.styleSelect.createEl("option", { text: file.basename, value: file.path });
    }
    this.styleSelect.addEventListener("change", () => {
      this.stylePathValue = this.styleFiles[this.styleSelect.selectedIndex - 1] ?? null;
    });
    this.styleSelect.disabled = true;
    this.styleSelect.selectedIndex = 0;
    this.stylePathValue = null;

    this.createTextField(form, "输出目录", "留空则使用默认目录", (input) => {
      input.value = this.defaultFolder || IMAGE_OUTPUT_FOLDER;
      this.outputFolderValue = input.value;
      input.addEventListener("input", () => {
        this.outputFolderValue = input.value;
      });
    });
    this.createNumberField(form, "张数", 1, (input) => {
      this.imageCountValue = Number.parseInt(input.value, 10) || 1;
      input.addEventListener("input", () => {
        this.imageCountValue = Number.parseInt(input.value, 10) || 1;
      });
    });
    this.createSelectField(form, "比例", ["9:16", "1:1", "3:2", "2:3", "16:9"], (select) => {
      select.value = "9:16";
      this.aspectRatioValue = select.value;
      select.addEventListener("change", () => {
        this.aspectRatioValue = select.value;
      });
    });

    const footer = contentEl.createDiv({ cls: "zimeiti-image-generate-actions" });
    footer.createEl("button", { text: "取消" }).onclick = () => {
      this.close();
      this.onSubmit(null);
    };
    footer.createEl("button", { text: "确认" }).onclick = () => {
      this.close();
      this.onSubmit({
        prompt: this.promptValue.trim(),
        styleEnabled: this.styleEnabledValue,
        stylePath: this.styleEnabledValue ? this.stylePathValue : null,
        outputFolder: this.outputFolderValue.trim(),
        imageCount: Math.max(1, this.imageCountValue),
        aspectRatio: this.aspectRatioValue.trim() || "1:1",
      });
    };
  }

  createTextField(parent: HTMLElement, labelText: string, placeholder: string, apply: (input: HTMLInputElement) => void) {
    const field = parent.createDiv({ cls: "zimeiti-image-field" });
    field.createEl("label", { text: labelText });
    const input = field.createEl("input", { type: "text", placeholder });
    apply(input);
  }

  createSelectField(parent: HTMLElement, labelText: string, options: string[], apply: (select: HTMLSelectElement) => void) {
    const field = parent.createDiv({ cls: "zimeiti-image-field" });
    field.createEl("label", { text: labelText });
    const select = field.createEl("select");
    for (const option of options) {
      select.createEl("option", { text: option, value: option });
    }
    apply(select);
  }

  createTextAreaField(parent: HTMLElement, labelText: string, placeholder: string, apply: (input: HTMLTextAreaElement) => void) {
    const field = parent.createDiv({ cls: "zimeiti-image-field" });
    field.createEl("label", { text: labelText });
    const input = field.createEl("textarea", { placeholder });
    input.rows = 4;
    apply(input);
  }

  createNumberField(parent: HTMLElement, labelText: string, defaultValue: number, apply: (input: HTMLInputElement) => void) {
    const field = parent.createDiv({ cls: "zimeiti-image-field" });
    field.createEl("label", { text: labelText });
    const input = field.createEl("input", { type: "number" });
    input.min = "1";
    input.value = String(defaultValue);
    apply(input);
  }
}

class ImageSelectionModal extends Modal {
  selected = new Set<TFile>();
  committed = false;
  allFiles: TFile[] = [];
  filteredFiles: TFile[] = [];
  searchInput!: HTMLInputElement;
  resultsEl!: HTMLDivElement;
  countEl!: HTMLElement;
  confirmBtn!: HTMLButtonElement;
  emptyEl!: HTMLDivElement;

  constructor(app: App, private onChoose: (files: TFile[]) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.empty();
    titleEl.addClass("zimeiti-note-modal-title");
    titleEl.createSpan({ text: "选择图片" });

    const actions = titleEl.createDiv({ cls: "zimeiti-note-modal-actions" });
    this.countEl = actions.createSpan({ cls: "zimeiti-note-modal-count", text: "已选 0 张" });
    this.confirmBtn = actions.createEl("button", {
      cls: "zimeiti-note-modal-confirm",
      attr: { "aria-label": "确认提交" },
    });
    this.confirmBtn.setText("✓");
    this.confirmBtn.disabled = true;
    this.confirmBtn.addEventListener("click", () => this.submit());

    this.allFiles = this.app.vault.getFiles().filter((file) => file instanceof TFile && IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) as TFile[];
    this.filteredFiles = [...this.allFiles];

    const searchWrap = contentEl.createDiv({ cls: "zimeiti-note-modal-search" });
    this.searchInput = searchWrap.createEl("input", {
      type: "search",
      placeholder: "搜索并勾选多张图片",
    });
    this.searchInput.addEventListener("input", () => this.refreshResults());
    this.searchInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.submit();
      }
    });

    this.resultsEl = contentEl.createDiv({ cls: "zimeiti-note-modal-results" });
    this.emptyEl = this.resultsEl.createDiv({ cls: "zimeiti-note-modal-empty" });
    this.emptyEl.setText("没有匹配到图片。");

    this.refreshResults();
    window.setTimeout(() => this.searchInput.focus(), 0);
  }

  matchesQuery(file: TFile, query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return file.path.toLowerCase().includes(normalized) || file.basename.toLowerCase().includes(normalized);
  }

  refreshResults() {
    const query = this.searchInput?.value ?? "";
    this.filteredFiles = this.allFiles.filter((file) => this.matchesQuery(file, query));
    this.renderResults();
    this.refreshCount();
  }

  renderResults() {
    this.resultsEl.empty();
    if (this.filteredFiles.length === 0) {
      this.resultsEl.appendChild(this.emptyEl);
      return;
    }

    for (const file of this.filteredFiles) {
      const row = this.resultsEl.createDiv({ cls: "zimeiti-note-modal-row" });
      if (this.selected.has(file)) row.addClass("is-selected");

      const main = row.createDiv({ cls: "zimeiti-note-modal-row-main" });
      main.createDiv({ cls: "zimeiti-note-modal-row-title", text: file.basename });
      main.createDiv({ cls: "zimeiti-note-modal-row-path", text: file.path });

      const mark = row.createDiv({ cls: "zimeiti-note-modal-row-mark" });
      mark.setText(this.selected.has(file) ? "✓" : "");

      row.addEventListener("click", () => this.toggleSelection(file));
    }
  }

  toggleSelection(file: TFile) {
    if (this.selected.has(file)) this.selected.delete(file);
    else this.selected.add(file);
    this.renderResults();
    this.refreshCount();
  }

  refreshCount() {
    this.countEl.setText(`已选 ${this.selected.size} 张`);
    this.confirmBtn.disabled = this.selected.size === 0;
  }

  submit() {
    if (this.selected.size === 0) {
      new Notice("请先选择至少一张图片。");
      return;
    }
    this.committed = true;
    this.close();
  }

  onClose() {
    if (!this.committed) this.onChoose([]);
    else this.onChoose([...this.selected]);
    this.contentEl.empty();
  }
}
