import { useState, useRef } from 'react';
import {
  Truck, X, RefreshCw, UserCheck, CheckCircle2, Shield, KeyRound, Phone,
  Package, Weight, Check, ChevronDown, ClipboardList,
} from 'lucide-react';
import type { LocalDriver, LocalTruck } from '../../data/assignmentTypes';

/* ── Helpers ── */
const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

/* ── Truck Classification & Capacity Options ── */
export const TRUCK_CLASSIFICATIONS = [
  { value: 'Pickup Truck',      desc: 'Light cargo, small deliveries'     },
  { value: 'Closed Van',        desc: 'Enclosed, weather-protected cargo'  },
  { value: 'Wing Van',          desc: 'Side-opening, easy loading'         },
  { value: 'Boom Truck',        desc: 'Crane-equipped for heavy lifts'     },
  { value: 'Semi-Trailer',      desc: 'Long-haul, high-volume cargo'       },
  { value: 'Refrigerated Van',  desc: 'Temperature-controlled cargo'       },
  { value: 'Flatbed Truck',     desc: 'Open bed, oversized freight'        },
  { value: 'Tanker',            desc: 'Liquid or bulk dry cargo'           },
];

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
function ModalShell({ title, onClose, layer = false, children, footer }: {
  title: string; onClose: () => void; layer?: boolean; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 flex items-center justify-center p-4 ${layer ? 'z-[70]' : 'z-50'}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
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
export function RegisterDriverModal({ setDrivers, onClose, onCreated, layer = false }: {
  setDrivers: React.Dispatch<React.SetStateAction<LocalDriver[]>>;
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

  const handleGeneratePin = () => {
    if (!surname.trim() || !firstName.trim()) { setNameError('Both surname and first name are required.'); return; }
    if (phoneNumber.replace(/\D/g, '').length !== 10) { setPhoneError('Enter a valid 10-digit mobile number.'); return; }
    setNameError(''); setPhoneError('');
    setGeneratedPin(generatePin());
  };

  const handleRegisterDriver = () => {
    if (!surname.trim() || !firstName.trim()) { setNameError('Both surname and first name are required.'); return; }
    if (phoneNumber.replace(/\D/g, '').length !== 10) { setPhoneError('Enter a valid 10-digit mobile number.'); return; }
    if (!generatedPin) { setNameError('Please generate a PIN first.'); return; }

    const newDriver: LocalDriver = {
      id: `DR${String(Date.now()).slice(-5)}`,
      name: `${firstName.trim()} ${surname.trim()}`,
      phone: `+63${phoneNumber.replace(/\D/g, '')}`,
      truckNumber: '—',
      status: 'Pending' as const,
      currentLocation: '—',
      deliveriesToday: 0, rating: 0,
      pin: generatedPin,
    };
    setDrivers((p) => [...p, newDriver]);
    onCreated?.(newDriver);
    setRegistered(true);
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
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Surname</span>
                <input
                  type="text" value={surname}
                  onChange={(e) => { setSurname(e.target.value); setNameError(''); }}
                  placeholder="e.g. dela Cruz"
                  className={`w-full px-4 py-3 rounded-xl border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm ${nameError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">First Name</span>
                <input
                  type="text" value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setNameError(''); }}
                  placeholder="e.g. Juan"
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
                onChange={(e) => { setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10)); setPhoneError(''); }}
                placeholder="9123456789"
                maxLength={10}
                className="flex-1 px-4 py-3 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-sm tracking-wider"
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
            <div className="flex items-center gap-3">
              <div className={`flex-1 px-4 py-3 rounded-xl border bg-muted/20 flex items-center gap-3 ${generatedPin ? 'border-primary/30' : 'border-border'}`}>
                <KeyRound className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                {generatedPin
                  ? <span className="font-mono text-lg tracking-[0.35em] font-semibold text-primary">{generatedPin}</span>
                  : <span className="text-sm text-muted-foreground italic">Click to generate</span>}
              </div>
              <button onClick={handleGeneratePin}
                className="flex items-center gap-2 px-4 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium whitespace-nowrap">
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

          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm">
              Cancel
            </button>
            <button onClick={handleRegisterDriver} disabled={!generatedPin}
              className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <UserCheck className="w-4 h-4" /> Register Driver
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
const TRUCK_STEP_NAMES = ['Plate number', 'Classification', 'Capacity & review'] as const;

export function RegisterTruckModal({ trucks, setTrucks, onClose, onCreated, layer = false }: {
  trucks: LocalTruck[];
  setTrucks: React.Dispatch<React.SetStateAction<LocalTruck[]>>;
  onClose: () => void;
  onCreated?: (truck: LocalTruck) => void;
  layer?: boolean;
}) {
  const [step,                setStep]                = useState(1);
  const [plateLetters,        setPlateLetters]        = useState('');
  const [plateNumbers,        setPlateNumbers]        = useState('');
  const [plateError,          setPlateError]          = useState('');
  const [truckClassification, setTruckClassification] = useState('');
  const [classError,          setClassError]          = useState('');
  const [truckCapacity,       setTruckCapacity]       = useState('');
  const [capacityError,       setCapacityError]       = useState('');
  const [truckRegistered,     setTruckRegistered]     = useState(false);
  const plateNumRef = useRef<HTMLInputElement>(null);

  const handlePlateLetters = (v: string) => {
    const c = v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
    setPlateLetters(c); setPlateError('');
    if (c.length === 3) plateNumRef.current?.focus();
  };
  const handlePlateNumbers = (v: string) => {
    setPlateNumbers(v.replace(/[^0-9]/g, '').slice(0, 4)); setPlateError('');
  };

  const handleNext = () => {
    if (step === 1) {
      if (plateLetters.length < 3 || plateNumbers.length < 3) {
        setPlateError('Enter at least 3 letters and 3 numbers (e.g. ABC 8473).');
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

  const handleRegisterTruck = () => {
    if (!truckCapacity) { setCapacityError('Please select the payload capacity.'); return; }
    const plate = `${plateLetters} ${plateNumbers}`;
    const newTruck: LocalTruck = {
      id: `T${String(Date.now()).slice(-5)}`,
      plateNumber: plate,
      status: 'Available',
      classification: truckClassification,
      capacity: truckCapacity,
    };
    setTrucks((p) => [...p, newTruck]);
    onCreated?.(newTruck);
    setTruckRegistered(true);
  };

  /* Progress bar — shown only during wizard steps */
  const progressIndicator = (
    <div className="mb-5">
      <p className="text-xs text-muted-foreground mb-2">
        Step {step} of 3 —{' '}
        <span className="font-medium text-foreground">{TRUCK_STEP_NAMES[step - 1]}</span>
      </p>
      <div className="flex gap-1.5">
        {([1, 2, 3] as const).map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${s <= step ? 'bg-primary' : 'bg-border'}`}
          />
        ))}
      </div>
    </div>
  );

  /* Pinned footer */
  const wizardFooter = (
    <div className="flex gap-3">
      <button
        onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
        className="flex-1 px-4 py-2.5 border border-border rounded-xl hover:bg-accent transition-colors text-sm"
      >
        {step === 1 ? 'Cancel' : 'Back'}
      </button>
      <button
        onClick={step === 3 ? handleRegisterTruck : handleNext}
        className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm font-medium flex items-center justify-center gap-2"
      >
        {step === 3 ? <><Check className="w-4 h-4" /> Register truck</> : 'Next'}
      </button>
    </div>
  );

  return (
    <ModalShell
      title="Register New Truck"
      onClose={onClose}
      layer={layer}
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
                Format: 3 letters + 3–4 numbers (e.g. ABC 8473)
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text" value={plateLetters}
                  onChange={(e) => handlePlateLetters(e.target.value)}
                  placeholder="ABC" maxLength={3}
                  className={`w-28 px-4 py-3 rounded-xl border text-center tracking-[0.25em] uppercase font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${plateError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
                />
                <span className="text-xl text-muted-foreground select-none">–</span>
                <input
                  ref={plateNumRef} type="text" inputMode="numeric" value={plateNumbers}
                  onChange={(e) => handlePlateNumbers(e.target.value)}
                  placeholder="8473" maxLength={4}
                  className={`w-32 px-4 py-3 rounded-xl border text-center tracking-[0.25em] font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary/30 ${plateError ? 'border-red-400 bg-red-50' : 'border-border bg-white'}`}
                />
              </div>
              {(plateLetters || plateNumbers) && (
                <div className="mt-3 px-4 py-2 bg-primary/5 border border-primary/20 rounded-lg inline-flex items-center gap-2">
                  <Truck className="w-4 h-4 text-primary" />
                  <span className="font-mono font-semibold text-primary tracking-widest">
                    {plateLetters || '___'} {plateNumbers || '____'}
                  </span>
                </div>
              )}
              {plateError && <p className="text-xs text-red-500 mt-2">{plateError}</p>}
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
              <div className="grid grid-cols-2 gap-2">
                {TRUCK_CLASSIFICATIONS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => { setTruckClassification(c.value); setClassError(''); }}
                    className={`relative px-3 py-3 rounded-xl border text-left transition-all ${
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
                    <p className="text-xs font-semibold text-foreground leading-tight pr-5">{c.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{c.desc}</p>
                  </button>
                ))}
              </div>
              {classError && <p className="text-xs text-red-500 mt-2">{classError}</p>}
            </div>
          )}

          {/* ── Step 3: Capacity + Review ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Weight className="w-4 h-4 text-primary/70" /> Payload capacity <span className="text-red-500">*</span>
                  </span>
                </label>
                <div className="relative">
                  <select
                    value={truckCapacity}
                    onChange={(e) => { setTruckCapacity(e.target.value); setCapacityError(''); }}
                    className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none bg-white ${
                      capacityError ? 'border-red-400 bg-red-50' : 'border-border'
                    } ${truckCapacity ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    <option value="">Select payload capacity…</option>
                    {TRUCK_CAPACITIES.map((cap) => (
                      <option key={cap} value={cap}>{cap}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
                {capacityError && <p className="text-xs text-red-500 mt-1.5">{capacityError}</p>}
              </div>

              {/* Review summary */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">Review</span>
                </div>
                <div className="divide-y divide-border">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">Plate number</span>
                    <span className="text-xs font-mono font-semibold text-foreground">{plateLetters} {plateNumbers}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">Classification</span>
                    <span className="text-xs font-medium text-foreground">{truckClassification}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-muted-foreground">Payload capacity</span>
                    <span className={`text-xs font-medium ${truckCapacity ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                      {truckCapacity || 'Not selected'}
                    </span>
                  </div>
                </div>
              </div>
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
            <p className="text-xs text-blue-700">Capacity: <strong>{truckCapacity}</strong></p>
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
