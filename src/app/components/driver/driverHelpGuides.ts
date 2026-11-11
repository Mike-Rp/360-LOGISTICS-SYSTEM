import type { DriverLanguage } from './driverI18n';

export interface DriverHelpGuide {
  id: string;
  category: string;
  title: string;
  keywords: string;
  steps: string[];
  common?: boolean;
}

const guides: Record<DriverLanguage, DriverHelpGuide[]> = {
  en: [
    { id: 'start', category: 'Getting Started', title: 'Get around the Driver Portal', keywords: 'dashboard menu language notifications', common: true, steps: [
      'After logging in, check Today’s Task on the Dashboard.',
      'Tap Menu to open Delivery History, Help & Guide, or Language.',
      'Tap the notification bell to read delivery and document updates.',
    ] },
    { id: 'deliveries', category: 'Deliveries', title: 'View my delivery', keywords: 'task assignment pickup destination schedule route', common: true, steps: [
      'On the Dashboard, tap View Task on your assigned delivery.',
      'Open Delivery Details to check the task ID, truck, pickup and delivery locations, dates, and Delivery Due time.',
      'Follow the Delivery Progress section for the next required action.',
    ] },
    { id: 'progress', category: 'Deliveries', title: 'Update delivery progress', keywords: 'pickup loading trip arrival unloading photos stage', common: true, steps: [
      'Open View Task and read the next step under Delivery Progress.',
      'At pickup, take the required truck and before-loading photos, then slide the on-screen action to confirm each stage.',
      'Finish loading, take the required after-loading and pre-trip photos, then start the trip.',
      'At the destination, confirm arrival, take the required unloading photos, and finish unloading as prompted.',
      'Check each stage before sliding; the portal shows what is required next.',
    ] },
    { id: 'documents', category: 'Documents', title: 'Upload delivery documents', keywords: 'proof of delivery approved rejected resubmit review', common: true, steps: [
      'After the delivery is marked Delivered, open Documents on the task.',
      'Tap a required document to take and upload a clear photo.',
      'Check its review status. A rejected document needs a new photo; tap it to retake and upload.',
      'You can also open a completed delivery in Delivery History to review its documents and upload a missing or rejected one.',
    ] },
    { id: 'delays', category: 'Issues', title: 'Report a pickup or delivery delay', keywords: 'late reason pickup delivery', steps: [
      'On View Task, tap Report Pickup Delay or Report Delivery Delay when that prompt appears.',
      'Select the reason that matches the delay and submit it.',
      'Review the saved entry under Delay Reports in the task.',
    ] },
    { id: 'issues', category: 'Issues', title: 'Report a delivery problem', keywords: 'issue problem reason paused review', steps: [
      'On View Task, tap Having a problem? Report it here.',
      'Choose the reason under Report a Problem and submit it.',
      'If delivery progress is paused for review, wait for OPM or CSR action before continuing.',
    ] },
    { id: 'history', category: 'History', title: 'Find a past delivery', keywords: 'completed cancelled search details', steps: [
      'Tap Menu, then Delivery History.',
      'Choose Completed or Cancelled and use the search field to find an assignment.',
      'Tap a delivery to see its saved details and available documents.',
    ] },
    { id: 'account', category: 'Account', title: 'Get PIN and language help', keywords: 'forgot pin support contact filipino english', steps: [
      'If you forgot your PIN, use Forgot your PIN? on the Driver Login screen to see the current support contact.',
      'While signed in, tap Menu, then Language to choose English or Filipino.',
      'The portal does not display or reset your existing PIN.',
    ] },
  ],
  fil: [
    { id: 'start', category: 'Pagsisimula', title: 'Gamitin ang Driver Portal', keywords: 'dashboard menu wika abiso', common: true, steps: [
      'Pagkatapos mag-log in, tingnan ang Gawain Ngayon sa Dashboard.',
      'I-tap ang Menu para buksan ang Kasaysayan ng Delivery, Tulong at Gabay, o Wika.',
      'I-tap ang kampana para basahin ang mga abiso tungkol sa delivery at dokumento.',
    ] },
    { id: 'deliveries', category: 'Mga Delivery', title: 'Tingnan ang aking delivery', keywords: 'gawain pickup destinasyon petsa ruta', common: true, steps: [
      'Sa Dashboard, i-tap ang Tingnan ang Gawain para sa nakatalagang delivery.',
      'Buksan ang Detalye ng Delivery para makita ang task ID, truck, lokasyon, petsa, at oras ng delivery.',
      'Sundin ang Pag-usad ng Delivery para sa susunod na kailangang gawin.',
    ] },
    { id: 'progress', category: 'Mga Delivery', title: 'I-update ang pag-usad ng delivery', keywords: 'pickup loading biyahe dating unloading litrato', common: true, steps: [
      'Buksan ang Tingnan ang Gawain at basahin ang susunod na hakbang sa Pag-usad ng Delivery.',
      'Sa pickup, kunan ang mga kinakailangang litrato ng truck at bago mag-load. I-slide ang nakasaad na aksiyon sa bawat yugto.',
      'Tapusin ang loading, kunan ang mga litrato pagkatapos mag-load at bago bumiyahe, saka simulan ang biyahe.',
      'Pagdating sa destinasyon, kumpirmahin ang pagdating, kunan ang mga litrato sa unloading, at tapusin ito ayon sa gabay.',
      'Suriin muna ang mga kailangan bago mag-slide.',
    ] },
    { id: 'documents', category: 'Mga Dokumento', title: 'Mag-upload ng dokumento', keywords: 'patunay aprubado tinanggihan ulitin review', common: true, steps: [
      'Kapag Delivered na ang delivery, buksan ang Mga Dokumento sa gawain.',
      'I-tap ang kinakailangang dokumento para kunan at i-upload ang malinaw na litrato.',
      'Tingnan ang estado ng pagsusuri. Kung tinanggihan, kumuha at mag-upload ng bagong litrato.',
      'Maaari ring buksan ang natapos na delivery sa Kasaysayan ng Delivery para tingnan ang mga dokumento at mag-upload ng kulang o tinanggihang dokumento.',
    ] },
    { id: 'delays', category: 'Mga Isyu', title: 'I-report ang pagkaantala', keywords: 'late pickup delivery dahilan', steps: [
      'Sa Tingnan ang Gawain, i-tap ang I-report ang Pagkaantala sa Pickup o Delivery kapag lumitaw ang paalala.',
      'Piliin ang angkop na dahilan at isumite.',
      'Tingnan ang naitalang ulat sa Mga Ulat ng Pagkaantala.',
    ] },
    { id: 'issues', category: 'Mga Isyu', title: 'I-report ang problema sa delivery', keywords: 'problema dahilan nakahinto pagsusuri', steps: [
      'Sa Tingnan ang Gawain, i-tap ang May problema? I-report dito.',
      'Piliin ang dahilan sa Mag-report ng Problema at isumite.',
      'Kung pansamantalang huminto ang pag-usad, hintayin ang aksiyon ng OPM o CSR bago magpatuloy.',
    ] },
    { id: 'history', category: 'Kasaysayan', title: 'Hanapin ang dating delivery', keywords: 'natapos kinansela hanap detalye', steps: [
      'I-tap ang Menu, saka ang Kasaysayan ng Delivery.',
      'Piliin ang Natapos o Kinansela at gamitin ang paghahanap.',
      'I-tap ang delivery para makita ang naitalang detalye at mga dokumento.',
    ] },
    { id: 'account', category: 'Account', title: 'Tulong sa PIN at wika', keywords: 'nakalimutan pin contact filipino english', steps: [
      'Kung nakalimutan ang PIN, gamitin ang Nakalimutan ang PIN? sa Driver Login para makita ang kasalukuyang contact na makakatulong.',
      'Habang naka-log in, i-tap ang Menu, saka Wika para pumili ng English o Filipino.',
      'Hindi ipinapakita o nire-reset ng portal ang dati mong PIN.',
    ] },
  ],
};

export function driverHelpGuides(language: DriverLanguage): DriverHelpGuide[] {
  return guides[language];
}

export function searchDriverHelpGuides(language: DriverLanguage, query: string): DriverHelpGuide[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return guides[language];
  return guides[language].filter((guide) =>
    `${guide.title} ${guide.category} ${guide.keywords} ${guide.steps.join(' ')}`.toLocaleLowerCase().includes(term));
}
