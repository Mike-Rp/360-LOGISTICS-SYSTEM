import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '../ui/alert-dialog';

/** Uses the same accessible confirmation and labels as the Dispatch form. */
export default function DiscardChangesDialog({ open, onKeepEditing, onDiscard }: {
  open: boolean; onKeepEditing: () => void; onDiscard: () => void;
}) {
  return <AlertDialog open={open} onOpenChange={(next) => { if (!next) onKeepEditing(); }}>
    <AlertDialogContent className="z-[100] max-w-sm motion-reduce:animate-none" overlayClassName="z-[90] motion-reduce:animate-none">
      <AlertDialogHeader>
        <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
        <AlertDialogDescription className="text-sm">Closing this form will discard your changes.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onKeepEditing}>Keep Editing</AlertDialogCancel>
        <AlertDialogAction onClick={onDiscard} className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600">Discard Changes</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
