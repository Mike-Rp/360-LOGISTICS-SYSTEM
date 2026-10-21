import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<ComponentProps<'input'>, 'type'> & { wrapperClassName?: string };

export default function PasswordVisibilityInput({ wrapperClassName, className, disabled, style, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <input {...inputProps} type={visible ? 'text' : 'password'} disabled={disabled}
        style={{ ...style, paddingRight: '3rem' }} className={className} />
      <button type="button" disabled={disabled} aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible} onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
