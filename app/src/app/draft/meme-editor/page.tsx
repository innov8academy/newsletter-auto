'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Text, Transformer } from 'react-konva';
import { Button } from '@/components/ui/button';
import { 
  Type, 
  Brush, 
  Eraser, 
  Upload, 
  Download, 
  Sparkles, 
  Undo2, 
  Trash2,
  ArrowLeft,
  Loader2,
  ImageIcon,
  Palette,
  Bold,
  Italic
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
// API key now handled server-side via env var

// Google Fonts that work well for memes
const FONTS = [
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Arial Black', value: 'Arial Black, sans-serif' },
  { name: 'Comic Sans', value: 'Comic Sans MS, cursive' },
  { name: 'Bebas Neue', value: 'Bebas Neue, sans-serif' },
  { name: 'Anton', value: 'Anton, sans-serif' },
  { name: 'Roboto Bold', value: 'Roboto, sans-serif' },
  { name: 'Oswald', value: 'Oswald, sans-serif' },
  { name: 'Bangers', value: 'Bangers, cursive' },
  { name: 'Permanent Marker', value: 'Permanent Marker, cursive' },
  { name: 'Passion One', value: 'Passion One, cursive' },
  { name: 'Black Ops One', value: 'Black Ops One, cursive' },
  { name: 'Creepster', value: 'Creepster, cursive' },
  { name: 'Bungee', value: 'Bungee, cursive' },
  { name: 'Russo One', value: 'Russo One, sans-serif' },
  { name: 'Righteous', value: 'Righteous, cursive' },
  { name: 'Press Start 2P', value: 'Press Start 2P, cursive' },
  { name: 'Titan One', value: 'Titan One, cursive' },
  { name: 'Luckiest Guy', value: 'Luckiest Guy, cursive' },
];

const COLORS = [
  '#FFFFFF', '#000000', '#FF0000', '#00FF00', '#0000FF', 
  '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080'
];

interface TextElement {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  draggable: boolean;
}

interface MaskLine {
  id: string;
  points: number[];
  stroke: string;
  strokeWidth: number;
  globalCompositeOperation: string;
}

type Tool = 'select' | 'text' | 'brush' | 'eraser';

export default function MemeEditorPage() {
  const router = useRouter();
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  
  // Canvas state
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [referenceImage, setReferenceImage] = useState<HTMLImageElement | null>(null);
  const [refImageUrl, setRefImageUrl] = useState<string>('');
  
  // Tools
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [brushSize, setBrushSize] = useState(30);
  
  // Text elements
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingPosition, setEditingPosition] = useState<{ x: number; y: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  
  // Text settings
  const [currentFont, setCurrentFont] = useState(FONTS[0].value);
  const [currentColor, setCurrentColor] = useState('#FFFFFF');
  const [currentStroke, setCurrentStroke] = useState('#000000');
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState(3);
  const [currentFontSize, setCurrentFontSize] = useState(48);
  const [shadowEnabled, setShadowEnabled] = useState(true);
  
  // Mask lines for AI replacement
  const [maskLines, setMaskLines] = useState<MaskLine[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // AI Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  
  // History for undo
  const [history, setHistory] = useState<MaskLine[][]>([]);

  // Load base image
  const handleBaseImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        // Scale to fit canvas while maintaining aspect ratio
        const maxWidth = 800;
        const maxHeight = 600;
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width;
          height = maxHeight;
        }
        
        setCanvasSize({ width, height });
        setBaseImage(img);
        setMaskLines([]);
        setHistory([]);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Load reference image
  const handleReferenceImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setRefImageUrl(dataUrl);
      const img = new window.Image();
      img.onload = () => setReferenceImage(img);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Add text element
  const addText = () => {
    const newText: TextElement = {
      id: `text-${Date.now()}`,
      x: canvasSize.width / 2 - 100,
      y: 50,
      text: 'Double-click to edit',
      fontSize: currentFontSize,
      fontFamily: currentFont,
      fill: currentColor,
      stroke: currentStroke,
      strokeWidth: currentStrokeWidth,
      shadowColor: shadowEnabled ? 'rgba(0,0,0,0.5)' : 'transparent',
      shadowBlur: shadowEnabled ? 4 : 0,
      shadowOffsetX: shadowEnabled ? 2 : 0,
      shadowOffsetY: shadowEnabled ? 2 : 0,
      draggable: true,
    };
    setTextElements([...textElements, newText]);
    setSelectedId(newText.id);
    setActiveTool('select');
  };

  // Handle text double-click for editing
  const handleTextDblClick = (id: string, e: any) => {
    const textNode = textElements.find(t => t.id === id);
    if (!textNode) return;
    
    // Get stage position for overlay input
    const stage = stageRef.current;
    if (!stage) return;
    
    const stageBox = stage.container().getBoundingClientRect();
    
    setEditingTextId(id);
    setEditingText(textNode.text);
    setEditingPosition({
      x: stageBox.left + textNode.x,
      y: stageBox.top + textNode.y,
    });
    
    // Focus input after render
    setTimeout(() => editInputRef.current?.focus(), 10);
  };
  
  // Save edited text
  const handleEditSave = () => {
    if (editingTextId && editingText.trim()) {
      setTextElements(textElements.map(t => 
        t.id === editingTextId ? { ...t, text: editingText } : t
      ));
    }
    setEditingTextId(null);
    setEditingText('');
    setEditingPosition(null);
  };
  
  // Cancel editing
  const handleEditCancel = () => {
    setEditingTextId(null);
    setEditingText('');
    setEditingPosition(null);
  };

  // Update selected text properties
  const updateSelectedText = (props: Partial<TextElement>) => {
    if (!selectedId) return;
    setTextElements(textElements.map(t => 
      t.id === selectedId ? { ...t, ...props } : t
    ));
  };

  // Delete selected
  const deleteSelected = () => {
    if (!selectedId) return;
    setTextElements(textElements.filter(t => t.id !== selectedId));
    setSelectedId(null);
  };

  // Drawing handlers for mask
  const handleMouseDown = (e: any) => {
    if (activeTool !== 'brush' && activeTool !== 'eraser') return;
    
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    
    // Save current state for undo
    setHistory([...history, maskLines]);
    
    const newLine: MaskLine = {
      id: `line-${Date.now()}`,
      points: [pos.x, pos.y],
      stroke: activeTool === 'brush' ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 0, 0, 1)',
      strokeWidth: brushSize,
      globalCompositeOperation: activeTool === 'eraser' ? 'destination-out' : 'source-over',
    };
    setMaskLines([...maskLines, newLine]);
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing) return;
    
    const pos = e.target.getStage().getPointerPosition();
    const lastLine = maskLines[maskLines.length - 1];
    if (!lastLine) return;
    
    const newPoints = [...lastLine.points, pos.x, pos.y];
    const updatedLines = [...maskLines];
    updatedLines[updatedLines.length - 1] = { ...lastLine, points: newPoints };
    setMaskLines(updatedLines);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  // Undo
  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setMaskLines(previousState);
    setHistory(history.slice(0, -1));
  };

  // Clear mask
  const clearMask = () => {
    setHistory([...history, maskLines]);
    setMaskLines([]);
  };

  // Get canvas as data URL (with mask overlay) - hides transformer first
  const getCanvasWithMask = (): string => {
    if (!stageRef.current) return '';
    
    // Hide transformer before export to avoid selection box in image
    if (transformerRef.current) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
    }
    
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
    
    // Restore transformer if something was selected
    if (selectedId && transformerRef.current) {
      const node = stageRef.current.findOne(`#${selectedId}`);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    }
    
    return dataUrl;
  };

  // Get canvas WITHOUT text - only base image + mask (for AI processing)
  const getCanvasForAI = (): string => {
    if (!stageRef.current || !baseImage) return '';
    
    // Create a temporary canvas with just the base image and mask
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasSize.width;
    tempCanvas.height = canvasSize.height;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return '';
    
    // Draw base image
    ctx.drawImage(baseImage, 0, 0, canvasSize.width, canvasSize.height);
    
    // Draw mask lines
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    maskLines.forEach(line => {
      if (line.globalCompositeOperation === 'destination-out') return; // Skip eraser for AI
      ctx.beginPath();
      ctx.strokeStyle = line.stroke;
      ctx.lineWidth = line.strokeWidth;
      for (let i = 0; i < line.points.length - 2; i += 2) {
        ctx.moveTo(line.points[i], line.points[i + 1]);
        ctx.lineTo(line.points[i + 2], line.points[i + 3]);
      }
      ctx.stroke();
    });
    
    return tempCanvas.toDataURL('image/jpeg', 0.85); // Use JPEG for smaller size
  };

  // Compress image to reduce payload size for API
  const compressImage = (dataUrl: string, maxWidth: number = 1024): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if too large
        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Generate with AI - uses server API route with env var
  const handleGenerate = async () => {
    if (!baseImage || maskLines.length === 0) {
      alert('Please upload an image and draw a mask first');
      return;
    }

    setIsGenerating(true);
    
    try {
      // Get canvas WITHOUT text overlays - only base image + mask
      const canvasDataUrl = getCanvasForAI();
      
      // Compress images to avoid 413 payload too large errors
      const compressedCanvas = await compressImage(canvasDataUrl, 1024);
      const compressedRef = refImageUrl ? await compressImage(refImageUrl, 512) : null;
      
      const response = await fetch('/api/meme-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canvasImage: compressedCanvas,
          referenceImage: compressedRef,
          hasReference: !!referenceImage,
          width: canvasSize.width,
          height: canvasSize.height,
        })
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Generation failed');
      }
      
      const imageUrl = data.imageUrl;
      
      if (imageUrl) {
        setGeneratedImage(imageUrl);
        
        // Load the generated image and resize to match canvas dimensions
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          // Create a canvas to resize the image to match original dimensions
          const resizeCanvas = document.createElement('canvas');
          resizeCanvas.width = canvasSize.width;
          resizeCanvas.height = canvasSize.height;
          const ctx = resizeCanvas.getContext('2d');
          if (ctx) {
            // Draw the AI result scaled to fit the original canvas size
            ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
            
            // Convert back to image
            const resizedImg = new window.Image();
            resizedImg.onload = () => {
              setBaseImage(resizedImg);
              setMaskLines([]); // Clear mask after successful generation
              setHistory([]);
            };
            resizedImg.src = resizeCanvas.toDataURL('image/png');
          } else {
            // Fallback: use original image
            setBaseImage(img);
            setMaskLines([]);
            setHistory([]);
          }
        };
        img.onerror = () => {
          console.log('[MemeEditor] Could not load generated image into canvas, keeping in sidebar');
        };
        img.src = imageUrl;
      } else {
        console.error('No image found in response:', data);
        throw new Error('No image in response');
      }
      
    } catch (error) {
      console.error('Generation error:', error);
      alert('Failed to generate. Check console for details.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Download image
  const handleDownload = () => {
    const dataUrl = generatedImage || getCanvasWithMask();
    const link = document.createElement('a');
    link.download = `meme-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  };

  // Handle selection
  const handleStageClick = (e: any) => {
    if (activeTool !== 'select') return;
    
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      setSelectedId(null);
    }
  };

  // Update transformer
  useEffect(() => {
    if (selectedId && transformerRef.current && stageRef.current) {
      const node = stageRef.current.findOne(`#${selectedId}`);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer().batchDraw();
      }
    }
  }, [selectedId]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/draft">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Draft
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">Meme Editor</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-60px)]">
        {/* Left Toolbar */}
        <div className="w-16 border-r border-zinc-800 p-2 flex flex-col gap-2">
          <Button
            variant={activeTool === 'select' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setActiveTool('select')}
            title="Select"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            </svg>
          </Button>
          
          <Button
            variant={activeTool === 'text' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => { setActiveTool('text'); addText(); }}
            title="Add Text"
          >
            <Type className="w-5 h-5" />
          </Button>
          
          <div className="h-px bg-zinc-800 my-1" />
          
          <Button
            variant={activeTool === 'brush' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setActiveTool('brush')}
            title="Mask Brush (for AI)"
          >
            <Brush className="w-5 h-5" />
          </Button>
          
          <Button
            variant={activeTool === 'eraser' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setActiveTool('eraser')}
            title="Eraser"
          >
            <Eraser className="w-5 h-5" />
          </Button>
          
          <div className="h-px bg-zinc-800 my-1" />
          
          <Button variant="ghost" size="icon" onClick={handleUndo} title="Undo">
            <Undo2 className="w-5 h-5" />
          </Button>
          
          <Button variant="ghost" size="icon" onClick={clearMask} title="Clear Mask">
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 p-4 overflow-auto flex items-center justify-center bg-zinc-900/50">
          <div className="relative">
            {!baseImage ? (
              <label className="flex flex-col items-center justify-center w-[800px] h-[600px] border-2 border-dashed border-zinc-700 rounded-lg cursor-pointer hover:border-zinc-500 transition-colors">
                <Upload className="w-12 h-12 text-zinc-500 mb-3" />
                <span className="text-zinc-400 text-lg">Upload meme template</span>
                <span className="text-zinc-500 text-sm mt-1">Click or drag image here</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleBaseImageUpload} />
              </label>
            ) : (
              <Stage
                ref={stageRef}
                width={canvasSize.width}
                height={canvasSize.height}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleStageClick}
                className="border border-zinc-700 rounded-lg overflow-hidden"
                style={{ background: '#1a1a1a' }}
              >
                {/* Background Image Layer */}
                <Layer>
                  <KonvaImage
                    image={baseImage}
                    width={canvasSize.width}
                    height={canvasSize.height}
                  />
                </Layer>
                
                {/* Mask Layer */}
                <Layer>
                  {maskLines.map((line) => (
                    <Line
                      key={line.id}
                      points={line.points}
                      stroke={line.stroke}
                      strokeWidth={line.strokeWidth}
                      tension={0.5}
                      lineCap="round"
                      lineJoin="round"
                      globalCompositeOperation={line.globalCompositeOperation as any}
                    />
                  ))}
                </Layer>
                
                {/* Text Layer */}
                <Layer>
                  {textElements.map((textEl) => (
                    <Text
                      key={textEl.id}
                      id={textEl.id}
                      x={textEl.x}
                      y={textEl.y}
                      text={textEl.text}
                      fontSize={textEl.fontSize}
                      fontFamily={textEl.fontFamily}
                      fill={textEl.fill}
                      stroke={textEl.stroke}
                      strokeWidth={textEl.strokeWidth}
                      shadowColor={textEl.shadowColor}
                      shadowBlur={textEl.shadowBlur}
                      shadowOffsetX={textEl.shadowOffsetX}
                      shadowOffsetY={textEl.shadowOffsetY}
                      draggable={textEl.draggable}
                      onClick={() => { setSelectedId(textEl.id); setActiveTool('select'); }}
                      onDblClick={(e) => handleTextDblClick(textEl.id, e)}
                      onDragEnd={(e) => {
                        setTextElements(textElements.map(t =>
                          t.id === textEl.id ? { ...t, x: e.target.x(), y: e.target.y() } : t
                        ));
                      }}
                    />
                  ))}
                  <Transformer
                    ref={transformerRef}
                    boundBoxFunc={(oldBox, newBox) => newBox}
                  />
                </Layer>
              </Stage>
            )}
            
            {/* Inline Text Editor Overlay */}
            {editingTextId && editingPosition && (
              <div 
                className="fixed z-50 bg-zinc-900 border border-zinc-600 rounded-lg shadow-xl p-2"
                style={{ 
                  left: editingPosition.x, 
                  top: editingPosition.y,
                  minWidth: '200px'
                }}
              >
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSave();
                    if (e.key === 'Escape') handleEditCancel();
                  }}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                  placeholder="Enter text..."
                />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={handleEditSave} className="flex-1 bg-purple-600 hover:bg-purple-700">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleEditCancel} className="flex-1">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-72 border-l border-zinc-800 p-4 overflow-y-auto">
          {/* Upload Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Images</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded-lg cursor-pointer hover:bg-zinc-700 transition-colors">
                <ImageIcon className="w-4 h-4" />
                <span className="text-sm">{baseImage ? 'Change Template' : 'Upload Template'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleBaseImageUpload} />
              </label>
              
              <label className="flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded-lg cursor-pointer hover:bg-zinc-700 transition-colors">
                <Upload className="w-4 h-4" />
                <span className="text-sm">{referenceImage ? 'Change Reference' : 'Upload Reference (for AI)'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleReferenceImageUpload} />
              </label>
              
              {referenceImage && (
                <div className="mt-2">
                  <img src={refImageUrl} alt="Reference" className="w-full h-24 object-cover rounded-lg" />
                </div>
              )}
            </div>
          </div>

          {/* Text Settings */}
          {selectedId && selectedId.startsWith('text-') && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Text Settings</h3>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Font</label>
                  <select
                    value={textElements.find(t => t.id === selectedId)?.fontFamily || currentFont}
                    onChange={(e) => {
                      setCurrentFont(e.target.value);
                      updateSelectedText({ fontFamily: e.target.value });
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm"
                  >
                    {FONTS.map(f => (
                      <option key={f.name} value={f.value}>{f.name}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Font Size</label>
                  <input
                    type="range"
                    min="12"
                    max="120"
                    value={textElements.find(t => t.id === selectedId)?.fontSize || currentFontSize}
                    onChange={(e) => {
                      const size = parseInt(e.target.value);
                      setCurrentFontSize(size);
                      updateSelectedText({ fontSize: size });
                    }}
                    className="w-full"
                  />
                </div>
                
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Text Color</label>
                  <div className="flex flex-wrap gap-1">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => {
                          setCurrentColor(color);
                          updateSelectedText({ fill: color });
                        }}
                        className={`w-6 h-6 rounded border-2 ${
                          (textElements.find(t => t.id === selectedId)?.fill || currentColor) === color 
                            ? 'border-white' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Stroke Color</label>
                  <div className="flex flex-wrap gap-1">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => {
                          setCurrentStroke(color);
                          updateSelectedText({ stroke: color });
                        }}
                        className={`w-6 h-6 rounded border-2 ${
                          (textElements.find(t => t.id === selectedId)?.stroke || currentStroke) === color 
                            ? 'border-white' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Stroke Width</label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={textElements.find(t => t.id === selectedId)?.strokeWidth || currentStrokeWidth}
                    onChange={(e) => {
                      const width = parseInt(e.target.value);
                      setCurrentStrokeWidth(width);
                      updateSelectedText({ strokeWidth: width });
                    }}
                    className="w-full"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="shadow"
                    checked={shadowEnabled}
                    onChange={(e) => {
                      setShadowEnabled(e.target.checked);
                      updateSelectedText({
                        shadowColor: e.target.checked ? 'rgba(0,0,0,0.5)' : 'transparent',
                        shadowBlur: e.target.checked ? 4 : 0,
                        shadowOffsetX: e.target.checked ? 2 : 0,
                        shadowOffsetY: e.target.checked ? 2 : 0,
                      });
                    }}
                    className="rounded"
                  />
                  <label htmlFor="shadow" className="text-sm">Text Shadow</label>
                </div>
                
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={deleteSelected}
                  className="w-full"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Text
                </Button>
              </div>
            </div>
          )}

          {/* Brush Settings */}
          {(activeTool === 'brush' || activeTool === 'eraser') && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Brush Settings</h3>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Size: {brushSize}px</label>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* AI Generate Section */}
          <div className="mt-auto pt-4 border-t border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">AI Generation</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Paint red mask over area to replace, then upload reference image (optional).
            </p>
            
            <Button 
              onClick={handleGenerate} 
              disabled={isGenerating || !baseImage}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate with AI
                </>
              )}
            </Button>
            
            {generatedImage && (
              <div className="mt-4">
                <h4 className="text-xs text-zinc-500 mb-2">Result:</h4>
                <img 
                  src={generatedImage} 
                  alt="Generated" 
                  className="w-full rounded-lg border border-zinc-700"
                />
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    const link = document.createElement('a');
                    link.download = `ai-meme-${Date.now()}.png`;
                    link.href = generatedImage;
                    link.click();
                  }}
                  className="w-full mt-2"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Result
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
