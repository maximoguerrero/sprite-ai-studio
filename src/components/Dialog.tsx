import { Dialog as ArkDialog } from "@ark-ui/react/dialog";
import type { ReactNode } from "react";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** Modal shell using Ark UI's accessible dialog behavior, following Park UI's Ark UI foundation. */
export function Dialog({ title, onClose, children }: DialogProps) {
  return (
    <ArkDialog.Root
      open
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
    >
      <ArkDialog.Backdrop className="park-dialog-backdrop" />
      <ArkDialog.Positioner className="modal-backdrop">
        <ArkDialog.Content className="dialog">
          <div className="dialog-header">
            <ArkDialog.Title className="dialog-title" id="dialog-title">
              {title}
            </ArkDialog.Title>
            <ArkDialog.CloseTrigger className="icon-button close-button" aria-label="Close">
              ×
            </ArkDialog.CloseTrigger>
          </div>
          {children}
        </ArkDialog.Content>
      </ArkDialog.Positioner>
    </ArkDialog.Root>
  );
}
