import { useEffect, useState } from "react";
import { loadImage } from "../imageStore";

export function AnchorPreview({ imageKey, dataUrl, name }: { imageKey?: string; dataUrl?: string; name: string }) {
  const [url, setUrl] = useState(dataUrl ?? "");
  useEffect(() => {
    if (dataUrl) {
      setUrl(dataUrl);
      return;
    }
    let objectUrl = "";
    if (imageKey)
      void loadImage(imageKey).then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageKey, dataUrl]);
  return url ? (
    <img src={url} alt={name} />
  ) : (
    <div className="anchor-placeholder">
      <span>✳</span>
      <small>ANCHOR IMAGE</small>
    </div>
  );
}
