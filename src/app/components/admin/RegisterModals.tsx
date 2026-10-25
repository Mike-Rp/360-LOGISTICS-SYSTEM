import { useState, useRef } from 'react';
import {
  Truck, X, RefreshCw, UserCheck, CheckCircle2, Shield, KeyRound, Phone,
  Package, Weight, Check, ChevronDown, ClipboardList,
} from 'lucide-react';
import type { LocalDriver, LocalTruck } from '../../data/assignmentTypes';
import { normaliseMobile, registerTruck, registerDriver, AssignmentActionError, type AssignmentActionErrorCode } from '../../lib/db';
import { parsePhilippineMobile } from '../../lib/philippineMobile';
import { TRUCK_CLASSIFICATIONS, formatCapacity, capacityKgOnly } from '../../data/truckTypes';
import TruckImage from '../TruckImage';

/* ── Helpers ── */
const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

/* Matches register_driver()'s server-side rule — letters, spaces, apostrophes,
   hyphens, periods only. */
const NAME_PATTERN = /^[A-Za-z][A-Za-z\s'.-]*$/;

/* Plain-language text for register_truck()'s error codes. */
const truckErrorMessage = (code: AssignmentActionErrorCode): string => ({
  duplicate_plate: 'This plate number was just registered by someone else. Try a different one.',
  not_authorized: 'Your account is not allowed to register a truck.',
  not_deployed: 'This feature isn\'t set up on the database yet (the migration hasn\'t been applied).',
  invalid: 'The server rejected one of the values. Check the form and try again.',
  network: 'Couldn\'t reach the server. Check your connection and try again.',
} as Partial<Record<AssignmentActionErrorCode, string>>)[code] ?? 'Could not register this truck. Please try again.';

/* Plain-language text for register_driver()'s error codes. */
const driverErrorMessage = (code: AssignmentActionErrorCode): string => ({
  duplicate_phone: 'That mobile number was just registered by someone else.',
  duplicate_name: 'That driver name was just registered by someone else.',
  invalid_name: 'Names can only contain letters, spaces, apostrophes, hyphens and periods.',
  not_authorized: 'Your account is not allowed to register a driver.',
  not_deployed: 'This feature isn\'t set up on the database yet (the migration hasn\'t been applied).',
  invalid: 'The server rejected one of the values. Check the form and try again.',
  network: 'Couldn\'t reach the server. Check your connection and try again.',
} as Partial<Record<AssignmentActionErrorCode, string>>)[code] ?? 'Could not register this driver. Please try again.';

/* ── Duplicate-account detection ──────────────────────────────────────────────
   Phones are compared through normaliseMobile (the same rule db.ts and the SQL
   normalise_mobile() use), so "+639171234567" and "09171234567" are recognised as
   the same number rather than slipping through as two accounts. A duplicate phone
   matters beyond tidiness: the driver's Auth login email is derived from it, so a
   second account with the same number fails at sync_driver_login and leaves a
   driver row behind with no login.

   `excludeId` exists so an edit screen can ignore the record being edited. No edit
   screen exists today; this keeps the check correct for whenever one is added. */
export function findDuplicateDriver(
  drivers: LocalDriver[],
  candidate: { phone?: string; name?: string; excludeId?: string },
): { field: 'phone' | 'name'; message: string } | null {
  const others = drivers.filter((d) => d.id !== candidate.excludeId);

  const phone = normaliseMobile(candidate.phone ?? '');
  if (phone && others.some((d) => normaliseMobile(d.phone) === phone)) {
    return { field: 'phone', message: 'This mobile number is already in use.' };
  }

  const name = (candidate.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name && others.some((d) => d.name.trim().toLowerCase().replace(/\s+/g, ' ') === name)) {
    return { field: 'name', message: 'A driver with this name already exists.' };
  }

  return null;
}

/* ── Truck Classification & Capacity Options ── */
/* Truck types, pictures and capacities now live in data/truckTypes.ts (shared by every screen) */
export { TRUCK_CLASSIFICATIONS, formatCapacity };

export const TRUCK_CAPACITIES = [
  'Up to 500 kg',
  '500 kg – 1,000 kg',
  '1,000 kg – 2,000 kg',
  '2,000 kg – 5,000 kg',
  '5,000 kg – 10,000 kg',
  '10,000 kg – 20,000 kg',
  '20,000 kg and above',
];

/* ── Modal Shell — `layer` lifts it above an already-open modal ── */
/* `wide` is only used by Register Truck (grid + details panel side by side) */
function ModalShell({ title, onClose, layer = false, wide = false, children, footer }: {
  title: string; onClose: () => void; layer?: boolean; wide?: boolean; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 flex items-center justify-center p-4 ${layer ? 'z-[70]' : 'z-50'}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 pb-5 pt-3 border-t border-border flex-shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Register Driver Modal
   ═══════════════════════════════════════════════════════ */
export function RegisterDriverModal({ drivers = [], onServerChange, onClose, onCreated, layer = false }: {
  /* Existing drivers, used only for the early soft duplicate check — the server
     re-checks live data authoritatively when the driver is actually registered. */
  drivers?: LocalDriver[];
  onServerChange: (action: () => Promise<void>) => Promise<void>;
  onClose: () => void;
  /* Fired once the driver row exists — lets the caller auto-select it */
  onCreated?: (driver: LocalDriver) => void;
  layer?: boolean;
}) {
  const [surname,      setSurname]      = useState('');
  const [firstName,    setFirstName]    = useState('');
  const [phoneNumber,  setPhoneNumber]  = useState('');
  const [phoneError,   setPhoneError]   = useState('');
  const [generatedPin, setGeneratedPin] = useState('');
  const [nameError,    setNameError]    = useState('');
  const [registered,   setRegistered]   = useState(false);
  const [registering,  setRegistering]  = useState(false);
  const [registerError, setRegisterError] = useState('');

  /* Full name as it will be stored, so the duplicate check compares like with like. */
  const fullName = () => `${firstName.trim()} ${surname.trim()}`;
  const fullPhone = () => parsePhilippineMobile(phoneNumber)?.international ?? '';

  const handlePhoneInput = (value: string) => {
    const digits = value.replace(/\D/g, '');
    const mobile = parsePhilippineMobile(value);
    if (mobile && digits.length > 10) {
      setPhoneNumber(mobile.subscriber);
      setPhoneError('');
      return;
    }
    if (digits.length > 10) {
      setPhoneError('Enter only the 10-digit mobile number after +63.');
      return;
    }
    setPhoneNumber(digits);
    setPhoneError('');
  };

  const handlePhonePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').trim();
    const mobile = parsePhilippineMobile(pasted);
    if (mobile) {
      setPhoneNumber(mobile.subscriber);
      setPhoneError('');
    } else if (/^\d{1,10}$/.test(pasted)) {
      setPhoneNumber(pasted);
      setPhoneError('');
    } else {
      setPhoneError('Paste a valid Philippine mobile number.');
    }
  };

  /* Shared by the blur handlers and by submit, so the same rules apply either way. */
  const validateDriver = (): boolean => {
    if (!surname.trim() || !firstName.trim()) { setNameError('Both surname and first name are required.'); return false; }
    if (!NAME_PATTERN.test(firstName.trim()) || !NAME_PATTERN.test(surname.trim())) {
      setNameError('Names can only contain letters, spaces, apostrophes, hyphens and periods.');
      return false;
    }
    if (phoneNumber.length !== 10) { setPhoneError('Enter a valid 10-digit mobile number.'); return false; }
    /* The login screen only accepts numbers starting with 9, so without this a driver
       could be registered who is permanently unable to sign in. */
    if (!phoneNumber.startsWith('9')) { setPhoneError('Mobile number must start with 9 (e.g. 9XX XXX XXXX).'); return false; }

    const dup = findDuplicateDriver(drivers, { phone: fullPhone(), name: fullName() });
    if (dup) {
      if (dup.field === 'phone') setPhoneError(dup.message);
      else                       setNameError(dup.message);
      return false;
    }
    setNameError(''); setPhoneError('');
    return true;
  };

  /* On blur: check only the field the person just left, so they are not shown an error
     about a field they have not filled in yet. */
  const checkPhoneOnBlur = () => {
    if (!phoneNumber) return;
    if (phoneNumber.length !== 10) { setPhoneError('Enter a valid 10-digit mobile number.'); return; }
    if (!phoneNumber.startsWith('9')) { setPhoneError('Mobile number must start with 9 (e.g. 9XX XXX XXXX).'); return; }
    const dup = findDuplicateDriver(drivers, { phone: fullPhone() });
    setPhoneError(dup?.field === 'phone' ? dup.message : '');
  };

  const checkNameOnBlur = () => {
    if (!surname.trim() || !firstName.trim()) return;
    if (!NAME_PATTERN.test(firstName.trim()) || !NAME_PATTERN.test(surname.trim())) {
      setNameError('Names can only contain letters, spaces, apostrophes, hyphens and periods.');
      return;
    }
    const dup = findDuplicateDriver(drivers, { name: fullName() });
    setNameError(dup?.field === 'name' ? dup.message : '');
  };

  const handleGeneratePin = () => {
    if (!validateDriver()) return;
    setGeneratedPin(generatePin());
  };

  const handleRegisterDriver = async () => {
    if (!validateDriver()) return;
    if (!generatedPin) { setNameError('Please generate a PIN first.'); return; }

    setRegisterError('');
    setRegistering(true);
    try {
      let newId = '';
      await onServerChange(async () => {
        newId = await registerDriver(firstName.trim(), surname.trim(), fullPhone(), generatedPin);
      });
      onCreated?.({
        id: newId, name: fullName(), phone: fullPhone(), truckNumber: '—',
        status: 'Pending', currentLocation: '—', deliveriesToday: 0, rating: 0, pin: generatedPin,
      });
      setRegistered(true);
    } catch (err) {
      setRegisterError(err instanceof AssignmentActionError ? driverErrorMessage(err.code) : 'Could not register this driver. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <ModalShell title="Register New Driver" onClose={onClose} layer={layer}>
      {!registered ? (
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Driver Name <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">First Name</span>
                <input
                  type="text" value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setNameError(''); }}
                  onBlur={checkNameOnBlur}
                  placeholder="e.g. Juan"
                  className={`w-full px-4 py-3 rounded-xl border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm ${nameError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Surname</span>
                <input
                  type="text" value={surname}
                  onChange={(e) => { setSurname(e.target.value); setNameError(''); }}
                  onBlur={checkNameOnBlur}
                  placeholder="e.g. dela Cruz"
                  className={`w-full px-4 py-3 rounded-xl border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm ${nameError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
                />
              </div>
            </div>
            {nameError && <p className="text-xs text-red-500 mt-1.5">{nameError}</p>}
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-primary/70" /> Mobile Number <span className="text-red-500">*</span></span>
            </label>
            <div className={`flex items-center rounded-xl border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30 ${phoneError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}>
              <span className="px-3 py-3 bg-muted/40 border-r border-border text-sm font-semibold text-foreground select-none whitespace-nowrap">+63</span>
              <input
                type="text" inputMode="numeric" value={phoneNumber}
                aria-label="Mobile number, ten digits after +63"
                onChange={(e) => handlePhoneInput(e.target.value)}
                onPaste={handlePhonePaste}
                onBlur={checkPhoneOnBlur}
                placeholder="9123456789"
                maxLength={10}
                className="min-w-0 flex-1 px-4 py-3 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-sm tracking-wider tabular-nums"
              />
              <span className={`px-3 text-xs font-medium tabular-nums ${phoneNumber.length === 10 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {phoneNumber.length}/10
              </span>
            </div>
            {phoneError && <p className="text-xs text-red-500 mt-1.5">{phoneError}</p>}
          </div>

          {/* Generate PIN */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Driver PIN <span className="text-xs text-muted-foreground">(4-digit, auto-generated)</span>
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className={`min-w-0 flex-1 px-4 py-3 rounded-xl border bg-muted/20 flex items-center gap-3 ${generatedPin ? 'border-primary/30' : 'border-border'}`}>
                <KeyRound className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                {generatedPin
                  ? <span className="font-mono text-lg tracking-[0.35em] font-semibold text-primary">{generatedPin}</span>
                  : <span className="text-sm text-muted-foreground italic">Click to generate</span>}
              </div>
              <button onClick={handleGeneratePin}
                className="flex w-full items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium whitespace-nowrap sm:w-auto">
                <RefreshCw className="w-4 h-4" />
                {generatedPin ? 'Regenerate' : 'Generate PIN'}
              </button>
            </div>
            {generatedPin && (
              <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Share this PIN with the driver privately.
              </p>
            )}
          </div>

          {registerError && <p role="alert" className="text-xs font-medium text-red-600">{registerError}</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} disabled={registering}
              className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              Cancel
            </button>
            <button onClick={handleRegisterDriver} disabled={!generatedPin || registering}
              className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <UserCheck className="w-4 h-4" /> {registering ? 'Registering…' : 'Register Driver'}
            </button>
          </div>
        </div>
      ) : (
        /* Success */
        <div className="text-center py-4 space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-lg">{firstName} {surname} Registered!</h4>
            <p className="text-sm text-muted-foreground mt-1">Driver is now available for task assignment.</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left space-y-1">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-2">
              <Shield className="w-3.5 h-3.5" /> Driver Login Credentials
            </p>
            <p className="text-xs text-amber-600">Surname: <strong>{surname}</strong></p>
            <p className="text-xs text-amber-600">First Name: <strong>{firstName}</strong></p>
            <p className="text-xs text-amber-600">PIN: <strong className="font-mono tracking-widest">{generatedPin}</strong></p>
          </div>
          <button onClick={onClose}
            className="w-full px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium">
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

/* ═══════════════════════════════════════════════════════
   Register Truck Modal  (3-step wizard)
   ═══════════════════════════════════════════════════════ */
const TRUCK_STEP_NAMES = ['Plate number', 'Classification', 'Review'] as const;

export function RegisterTruckModal({ trucks, onServerChange, onClose, onCreated, layer = false }: {
  /* Existing trucks, used only for the early soft duplicate-plate check at step 1 — the
     server re-checks live data authoritatively when the truck is actually registered. */
  trucks: LocalTruck[];
  onServerChange: (action: () => Promise<void>) => Promise<void>;
  onClose: () => void;
  onCreated?: (truck: LocalTruck) => void;
  layer?: boolean;
}) {
  const [step,                setStep]                = useState(1);
  const [plateLetters,        setPlateLetters]        = useState('');
  const [plateNumbers,        setPlateNumbers]        = useState('');
  const [plateError,          setPlateError]          = useState('');
  const [lettersBlurred,      setLettersBlurred]      = useState(false);
  const [numbersBlurred,      setNumbersBlurred]      = useState(false);
  const [truckClassification, setTruckClassification] = useState('');
  const [classError,          setClassError]          = useState('');
  const [truckRegistered,     setTruckRegistered]     = useState(false);
  const [registering,         setRegistering]         = useState(false);
  const [registerError,       setRegisterError]       = useState('');
  const plateNumRef     = useRef<HTMLInputElement>(null);
  const plateLettersRef = useRef<HTMLInputElement>(null);

  /* Capacity is derived from the chosen type — nothing for the admin to pick */
  const selectedClass = TRUCK_CLASSIFICATIONS.find((c) => c.value === truckClassification) ?? null;
  const truckCapacity = selectedClass ? formatCapacity(selectedClass.capacityMinKg, selectedClass.capacityMaxKg) : '';
  const plateIsValid = plateLetters.length === 3 && plateNumbers.length >= 3 && plateNumbers.length <= 4;
  const lettersInvalid = lettersBlurred && plateLetters.length !== 3;
  const numbersInvalid = numbersBlurred && (plateNumbers.length < 3 || plateNumbers.length > 4);
  const plateHasInput = Boolean(plateLetters || plateNumbers);
  const platePreview = plateHasInput ? [plateLetters, plateNumbers].filter(Boolean).join(' ') : 'ABC 1234';

  const handlePlateLetters = (v: string) => {
    const c = v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
    setPlateLetters(c); setPlateError('');
    if (c.length === 3) plateNumRef.current?.focus();
  };
  const handlePlateNumbers = (v: string) => {
    setPlateNumbers(v.replace(/[^0-9]/g, '').slice(0, 4)); setPlateError('');
  };

  /* Pasting a whole plate ("ABC 8473", "abc8473", "ABC-8473") into either box fills both.
     Text without both letters and digits pastes normally. */
  const handlePlatePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text    = e.clipboardData.getData('text');
    const letters = text.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
    const digits  = text.replace(/[^0-9]/g, '').slice(0, 4);
    if (!letters || !digits) return;
    e.preventDefault();
    setPlateLetters(letters);
    setPlateNumbers(digits);
    setPlateError('');
    plateNumRef.current?.focus();
  };

  /* Backspace in an empty numbers box goes back to the end of the letters box */
  const handleNumbersKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Backspace' || plateNumbers !== '') return;
    e.preventDefault();
    const el = plateLettersRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  };

  const handleNext = () => {
    if (step === 1) {
      if (!plateIsValid) {
        setPlateError('Enter exactly 3 letters and 3–4 numbers.');
        return;
      }
      const plate = `${plateLetters} ${plateNumbers}`;
      if (trucks.some((t) => t.plateNumber === plate)) {
        setPlateError('This plate number is already registered.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!truckClassification) {
        setClassError('Please select a truck classification.');
        return;
      }
      setStep(3);
    }
  };

  const handleRegisterTruck = async () => {
    if (!selectedClass) { setClassError('Please select a truck classification.'); setStep(2); return; }
    const plate = `${plateLetters} ${plateNumbers}`;
    setRegisterError('');
    setRegistering(true);
    try {
      let newId = '';
      await onServerChange(async () => { newId = await registerTruck(plate, truckClassification, truckCapacity); });
      onCreated?.({ id: newId, plateNumber: plate, status: 'Available', classification: truckClassification, capacity: truckCapacity });
      setTruckRegistered(true);
    } catch (err) {
      setRegisterError(err instanceof AssignmentActionError ? truckErrorMessage(err.code) : 'Could not register this truck. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  /* Numbered stepper — the existing Next/Back handlers remain the only way to advance. */
  const progressIndicator = (
    <div className="mb-5">
      <p className="text-xs text-muted-foreground mb-3">
        Step {step} of 3 —{' '}
        <span className="font-medium text-foreground">{TRUCK_STEP_NAMES[step - 1]}</span>
      </p>
      <ol className="flex w-full" aria-label="Truck registration steps">
        {TRUCK_STEP_NAMES.map((name, index) => {
          const number = index + 1;
          const complete = number < step;
          const current = number === step;
          return (
            <li key={name} aria-current={current ? 'step' : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center text-center">
              {index > 0 && (
                <span aria-hidden="true" className={`absolute right-1/2 top-[13px] h-0.5 w-full transition-colors duration-300 motion-reduce:transition-none ${number <= step ? 'bg-primary' : 'bg-border'}`} />
              )}
              <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-300 motion-reduce:transition-none ${complete || current ? 'bg-primary text-white' : 'border border-border bg-white text-muted-foreground'} ${current ? 'ring-4 ring-primary/10' : ''}`}>
                {complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : number}
              </span>
              <span className={`mt-2 max-w-full px-1 text-[11px] leading-tight sm:text-xs ${current ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                {name}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  /* Pinned footer */
  const wizardFooter = (
    <div>
      {registerError && <p role="alert" className="mb-2 text-xs font-medium text-red-600">{registerError}</p>}
      <div className="flex gap-3">
      <button
        onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
        disabled={registering}
        className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {step === 1 ? 'Cancel' : 'Back'}
      </button>
      <button
        onClick={step === 3 ? handleRegisterTruck : handleNext}
        disabled={(step === 1 && !plateIsValid) || registering}
        className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {step === 3 ? <><Check className="w-4 h-4" /> {registering ? 'Registering…' : 'Register truck'}</> : 'Next'}
      </button>
      </div>
    </div>
  );

  return (
    <ModalShell
      title="Register New Truck"
      onClose={onClose}
      layer={layer}
      wide
      footer={!truckRegistered ? wizardFooter : undefined}
    >
      {!truckRegistered ? (
        <div>
          {progressIndicator}

          {/* ── Step 1: Plate Number ── */}
          {step === 1 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Plate number <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                Format: 3 letters + 3–4 numbers (e.g. ABC 1234)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label htmlFor="truck-plate-letters" className="mb-1 block text-xs font-medium text-muted-foreground">Letters</label>
                  <input
                    id="truck-plate-letters" ref={plateLettersRef} type="text" value={plateLetters}
                    onChange={(e) => handlePlateLetters(e.target.value)}
                    onBlur={() => setLettersBlurred(true)}
                    onPaste={handlePlatePaste}
                    placeholder="ABC" maxLength={3} autoCapitalize="characters"
                    aria-invalid={lettersInvalid || !!plateError}
                    aria-describedby={lettersInvalid ? 'truck-plate-letters-error' : plateError ? 'truck-plate-error' : undefined}
                    className={`w-full min-w-0 px-4 py-3 rounded-xl border text-center uppercase font-mono text-lg placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/30 ${lettersInvalid || plateError ? 'border-red-400 bg-red-50' : plateLetters.length === 3 ? 'border-green-400 bg-white' : 'border-border bg-white'}`}
                  />
                  {lettersInvalid && <p id="truck-plate-letters-error" className="mt-1 text-xs text-red-500">Enter exactly 3 letters.</p>}
                </div>
                <div className="min-w-0">
                  <label htmlFor="truck-plate-numbers" className="mb-1 block text-xs font-medium text-muted-foreground">Numbers</label>
                  <input
                    id="truck-plate-numbers" ref={plateNumRef} type="text" inputMode="numeric" value={plateNumbers}
                    onChange={(e) => handlePlateNumbers(e.target.value)}
                    onBlur={() => setNumbersBlurred(true)}
                    onPaste={handlePlatePaste}
                    onKeyDown={handleNumbersKeyDown}
                    placeholder="1234" maxLength={4}
                    aria-invalid={numbersInvalid || !!plateError}
                    aria-describedby={numbersInvalid ? 'truck-plate-numbers-error' : plateError ? 'truck-plate-error' : undefined}
                    className={`w-full min-w-0 px-4 py-3 rounded-xl border text-center font-mono text-lg placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/30 ${numbersInvalid || plateError ? 'border-red-400 bg-red-50' : plateNumbers.length >= 3 ? 'border-green-400 bg-white' : 'border-border bg-white'}`}
                  />
                  {numbersInvalid && <p id="truck-plate-numbers-error" className="mt-1 text-xs text-red-500">Enter 3–4 numbers.</p>}
                </div>
              </div>
              <div className={`mt-4 rounded-xl border px-4 py-3 text-center ${plateIsValid && !plateError ? 'border-green-300 bg-green-50/40' : 'border-border bg-muted/20'}`}>
                <p className="text-xs text-muted-foreground">Plate preview</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${plateIsValid && !plateError ? 'text-foreground' : 'text-muted-foreground'}`}>{platePreview}</p>
                {!plateHasInput && <p className="mt-1 text-xs text-muted-foreground">Enter 3 letters and 3–4 numbers to see the preview.</p>}
                {plateHasInput && !plateIsValid && <p className="mt-1 text-xs text-muted-foreground">{lettersInvalid || numbersInvalid ? 'Please enter a valid plate number.' : 'Complete the plate number.'}</p>}
                {plateError && <p className="mt-1 text-xs text-muted-foreground">Please enter a valid plate number.</p>}
              </div>
              {plateError && <p id="truck-plate-error" className="text-xs text-red-500 mt-2">{plateError}</p>}
            </div>
          )}

          {/* ── Step 2: Classification ── */}
          {step === 2 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-3">
                <span className="flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-primary/70" /> Truck classification <span className="text-red-500">*</span>
                </span>
              </label>
              {/* Grid + details panel side by side, same height (the card rows stretch evenly to fill it).
                  Below 640px the panel stacks under the grid and nothing is stretched. */}
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_14rem] gap-4 items-start sm:items-stretch">
              {/* Equal-height cards (auto-rows-fr), name centred vertically; the description lives in the panel */}
              <div className="grid grid-cols-2 auto-rows-fr gap-2">
                {TRUCK_CLASSIFICATIONS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => { setTruckClassification(c.value); setClassError(''); }}
                    className={`relative min-h-[3.25rem] px-3 py-3 rounded-xl border text-left flex items-center transition-all ${
                      truckClassification === c.value
                        ? 'border-primary bg-blue-50 ring-2 ring-primary/20'
                        : classError
                        ? 'border-red-300 bg-red-50 hover:bg-red-50/70'
                        : 'border-border bg-white hover:bg-accent'
                    }`}
                  >
                    {truckClassification === c.value && (
                      <span className="absolute top-2 right-2 w-4 h-4 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                    <p className="text-xs font-semibold text-foreground leading-tight pr-5 break-words min-w-0">{c.value}</p>
                  </button>
                ))}
              </div>

              {/* Details panel */}
              <div className="rounded-xl border border-border bg-muted/20 p-3 flex flex-col">
                {selectedClass ? (
                  <div>
                    {/* Whole truck, 4:3 like the image; capped on phones so the stacked picture doesn't take over */}
                    <TruckImage src={selectedClass.fullImageSrc} alt={selectedClass.value}
                      className="w-full max-w-[12rem] sm:max-w-full mx-auto aspect-[4/3] rounded-lg bg-white" />
                    <p className="text-sm font-semibold text-foreground mt-3 break-words">{selectedClass.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{selectedClass.desc}</p>
                    <p className="text-[12px] text-muted-foreground uppercase tracking-wide mt-2">{selectedClass.capacityLabel}</p>
                    <p className="text-sm font-medium text-foreground break-words">{capacityKgOnly(truckCapacity)}</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-2">
                    <Truck className="w-10 h-10 text-muted-foreground/40 mb-2" />
                    <p className="text-xs text-muted-foreground">Select a truck type to see its details.</p>
                  </div>
                )}
              </div>
              </div>
              {classError && <p className="text-xs text-red-500 mt-2">{classError}</p>}
            </div>
          )}

          {/* ── Step 3: Review (read-only receipt) ── */}
          {step === 3 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Review</span>
              </div>

              {selectedClass && (
                <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
                  <TruckImage src={selectedClass.fullImageSrc} alt={selectedClass.value}
                    className="w-24 h-[4.5rem] sm:w-32 sm:h-24 flex-shrink-0 rounded-lg bg-white border border-border" />
                  <div className="min-w-0 break-words">
                    <p className="text-sm font-semibold text-foreground">{selectedClass.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{selectedClass.desc}</p>
                  </div>
                </div>
              )}

              <div className="divide-y divide-border">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">Plate number</span>
                  <span className="text-xs font-mono font-semibold text-foreground text-right min-w-0 break-words">{plateLetters} {plateNumbers}</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">Classification</span>
                  <span className="text-xs font-medium text-foreground text-right min-w-0 break-words">{truckClassification}</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Weight className="w-3.5 h-3.5" /> {selectedClass?.capacityLabel ?? 'Payload capacity'}
                  </span>
                  <span className="text-xs font-medium text-foreground text-right min-w-0 break-words">{capacityKgOnly(truckCapacity)}</span>
                </div>
              </div>
              <p className="px-4 py-2 bg-muted/20 border-t border-border text-[12px] text-muted-foreground">
                Capacity is set automatically from the truck type.
              </p>
            </div>
          )}
        </div>
      ) : (
        /* Success */
        <div className="text-center py-4 space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-lg font-mono tracking-wider">
              {plateLetters} {plateNumbers}
            </h4>
            <p className="text-sm text-muted-foreground mt-1">Truck registered and ready for assignment.</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left space-y-2">
            <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5 mb-2">
              <Truck className="w-3.5 h-3.5" /> Truck details
            </p>
            <p className="text-xs text-blue-700">Plate: <strong className="font-mono">{plateLetters} {plateNumbers}</strong></p>
            <p className="text-xs text-blue-700">Classification: <strong>{truckClassification}</strong></p>
            <p className="text-xs text-blue-700">Capacity: <strong>{capacityKgOnly(truckCapacity)}</strong></p>
          </div>
          <button onClick={onClose}
            className="w-full px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium">
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}
