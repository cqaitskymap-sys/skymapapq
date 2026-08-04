'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AttachmentUploader({
  onUpload,
  disabled,
}: {
  onUpload: (file: File) => Promise<{ url?: string; error?: string }>;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const { error, url } = await onUpload(file);
    setUploading(false);
    if (error) toast.error(error);
    else toast.success(url ? `${file.name} uploaded and linked to PQR` : `${file.name} uploaded`);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LabelledFileInput
        inputRef={inputRef}
        disabled={disabled || uploading}
        onChange={(file) => void handleFile(file)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        aria-label="Upload attachment"
      >
        <Upload className="h-4 w-4 mr-1" />
        {uploading ? 'Uploading...' : 'Upload Attachment'}
      </Button>
    </div>
  );
}

function LabelledFileInput({
  inputRef,
  disabled,
  onChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onChange: (file: File | undefined) => void;
}) {
  return (
    <Input
      ref={inputRef}
      type="file"
      className="max-w-xs"
      disabled={disabled}
      aria-label="Choose attachment file"
      onChange={(e) => onChange(e.target.files?.[0])}
    />
  );
}
