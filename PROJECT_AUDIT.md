# 360 Logistics — Full Project Inventory & Audit
> Generated: May 11, 2026

---

## APPLICATION OVERVIEW

The app has **3 top-level views** controlled by `App.tsx`:
- `login` → `LoginScreen`
- `admin` → `AdminDashboard` (desktop-first, 6 nav sections)
- `driver` → `DriverInterface` (mobile-first)

State lives entirely in `App.tsx` and is persisted to Supabase KV via `PUT /app-data` with a 1.5-second debounced auto-save. The server polls every 12 seconds (admin) or 5 seconds (driver).

---

## PAGE 1 — Login Screen
**File:** `/src/app/components/auth/LoginScreen.tsx`
**Route:** Shown when `view === 'login'` in App.tsx

### Sub-views (toggled by footer button)
| Sub-view | Default |
|---|---|
| Driver Login | ✅ Default |
| Admin Login | Desktop only |

---

### Driver Login Sub-view

**Input Fields:**
| Field | Type | Validation |
|---|---|---|
| Surname | Text | Required; both surname + first name required |
| First Name | Text | Required |
| Plate Letters | Text (uppercase, max 3 chars) | Auto-uppercased; only letters; min 3 chars; auto-focuses plate numbers field when 3 chars entered |
| Plate Numbers | Text (numeric, max 4 digits) | Digits only; min 3 chars |
| PIN digit 1–4 | Password (one digit per box) | Digits only; auto-advances to next box on entry; backspace moves backwards |

**Buttons:**
| Button | Action |
|---|---|
| Login | Calls `handleDriverLogin()` |
| Forgot PIN | Shows "Contact your admin to reset your PIN" message for 3.5 seconds |
| Admin Login (footer) | Switches to admin sub-view _(desktop only; hidden on mobile — shows "Admin access requires a desktop computer" message instead)_ |

**Displayed Data:**
- 360 Logistics logo (image asset)
- "Trucking Operations & Delivery Tracking" subtitle
- Live plate preview badge (shown as soon as letters or numbers are typed)
- Error banners on: Name not found (`UserX` icon), Truck not found (`TruckIcon` icon), Wrong PIN (`KeySquare` icon), General error (`AlertCircle` icon)
- Forgot-PIN info message (auto-dismisses after 3.5 s)
- Loading state: "Verifying…" with spinner

**Conditional Logic / Rules:**
1. **Server-first validation:** Calls `POST /driver-login` with a 5-second AbortSignal timeout
2. **Offline fallback:** If server is unreachable, validates locally against the `drivers` and `trucks` arrays passed as props. Checks: `firstName + surname` match (both orderings tried), plate match (strip spaces/dashes for comparison), PIN match
3. **Offline + no data:** Shows "Server is offline and no accounts are loaded" error
4. Specific server error codes map to specific error banner types: `driver_not_found` → name banner, `truck_not_found` / `truck_taken` → plate banner, `wrong_pin` → PIN banner
5. Enter key on any field triggers login

---

### Admin Login Sub-view

**Input Fields:**
| Field | Type | Notes |
|---|---|---|
| Company Email | email | Trimmed, lowercased before comparison |
| Password | password (toggleable) | Toggle eye button shows/hides |

**Buttons:**
| Button | Action |
|---|---|
| Eye / EyeOff toggle | Show/hide password |
| Login | Calls `handleAdminLogin()` |
| Back (footer) | Returns to driver sub-view |

**Displayed Data:**
- Error message inline below fields (red, with `AlertCircle` icon)

**Conditional Logic / Rules:**
1. **Mobile block:** If `window.innerWidth < 768`, login is rejected with "Admin access is only available on desktop or laptop computers." even before credential check
2. **Hardcoded credentials (frontend only):**

| Email | Password | Role |
|---|---|---|
| `360logistics@email.ph` | `360Admin2026!` | `admin` |
| `admin360logistics@gmail.ph` | `360Demo2026!` | `demo` |
| `admin360logistics@email.com` | `360View2026!` | `viewer` |

3. On success: generates token `btoa(email:role:timestamp)`, stores in `localStorage` (`360_admin_token`, `360_admin_role`), calls `onAdminLogin(token, role)`
4. Session restoration on mount: reads from localStorage; if on mobile, clears admin session and falls through to check for driver session

---

## PAGE 2 — Admin Dashboard
**File:** `/src/app/components/admin/AdminDashboard.tsx`
**Route:** Shown when `view === 'admin'`

### Layout
- Fixed left **Sidebar** (w-64) + right scrollable **main** area
- Sticky top **role + DB status bar**
- Fixed **Header** with notifications

### Role badge / DB status bar (always visible)

| Role | Badge Color | DB Status shown |
|---|---|---|
| `admin` | Green | "Saving…" (spinner) or "Saved to database" (cloud icon) |
| `demo` | Blue | "Saving…" or "Saved to database" |
| `viewer` | Amber | "Live database" (eye icon) + "Read-only — you cannot add, edit, or delete" warning |

---

## COMPONENT — Sidebar
**File:** `/src/app/components/admin/Sidebar.tsx`

**Navigation Buttons (6):**
| Label | Icon | Sets `activeNav` to |
|---|---|---|
| Dashboard | LayoutDashboard | `'Dashboard'` |
| Monitor | MonitorCheck | `'Monitor'` |
| Deliveries | Package | `'Deliveries'` |
| Documents | FileText | `'Documents'` |
| Reports | BarChart3 | `'Reports'` |
| Accounts | UserCog | `'Accounts'` |

**Other Buttons:**
- **Log Out** (red, bottom) — calls `onLogout()` which clears all localStorage and resets all state

**Displayed Data:**
- 360 Logistics logo image
- "Admin Portal" label
- Active nav item highlighted in primary green

---

## COMPONENT — Header (Notifications)
**File:** `/src/app/components/admin/Header.tsx`

**Buttons:**
| Button | Action |
|---|---|
| Bell icon | Toggles notification dropdown (closes on outside click) |
| Mark all read | Sets all notifications to `read: true` |
| Clear all | Sets notifications array to `[]` |
| Individual notification | Marks as read + navigates to `n.navigateTo` page |
| X on each notification (hover-visible) | Deletes that single notification |

**Displayed Data:**
- Red badge count on bell (bounces; shows `99+` if > 99 unread)
- Notification dropdown (420px wide, max-h-80 scrollable):
  - Notification icon varies by type: `Camera` (status_update), `FileText` (doc_upload), `AlertTriangle` (delay_report), `AlertCircle` (issue_report)
  - Truck plate badge (teal), message text, timestamp, "Go to [page]" arrow on hover
  - Unread dot (blue)
  - Footer: unread count or "All caught up!"
- Profile: hardcoded "Admin User" / "admin@360logistics.com" + black circle avatar
- Empty state: bell icon + "No notifications"

**Conditional Logic:**
- Unread notifications have `bg-primary/5` background and bold text
- `navigateTo` field drives which admin section to open on click
- Outside click closes dropdown

---

## ADMIN NAV — Dashboard View
**Rendered by:** `AdminDashboard.renderContent()` when `activeNav === 'Dashboard'`
**Components:** `KPICards` + `DeliveryStatusBoard` + `Charts` + `DeliveryTable` (mini / Recent Activities mode)

---

## COMPONENT — KPI Cards
**File:** `/src/app/components/admin/KPICards.tsx`

**Displayed Data (6 cards — all live-computed):**
| Card | Formula |
|---|---|
| Available Trucks | `trucks.filter(t => t.status === 'Available').length` |
| Active Assignments | `assignments.length` |
| Available Drivers | `drivers.filter(d => no active assignment for d.id).length` |
| Completed Deliveries | `completed.length` (all-time) |
| Delayed Deliveries | Active assignments where `delayReports.length > 0` OR `deliveryDate` is past today |
| Docs Pending Review | Sum of docs where `uploaded === true && docStatus === 'pending'` across all assignments |

**Conditional Logic:**
- "Delayed" and "Docs Pending" cards highlight in amber with a ring border when count > 0
- Sub-text changes contextually (e.g., "All trucks available", "No completions yet", "Awaiting admin approval")

---

## COMPONENT — Delivery Status Board
**File:** `/src/app/components/admin/DeliveryStatusBoard.tsx`

**Displayed Data:**
- 6 status columns: Assigned, Picked Up, In Transit, Delivered, Failed/Issue, Cancelled
- Each column: count badge, status label with colored dot, percentage of total, bottom accent bar (width = % of total)
- Mini stacked progress bar across all statuses at the bottom
- Total deliveries count

**Buttons:**
| Button | Action |
|---|---|
| "View All" (header) | Calls `onNavigateToDeliveries()` → sets nav to `'Deliveries'` |
| Each status card | Also calls `onNavigateToDeliveries()` |

---

## COMPONENT — Charts
**File:** `/src/app/components/admin/Charts.tsx`

**Displayed Data:**
- **Weekly Deliveries Line Chart** (Recharts): Uses **static mock data** (`weeklyDeliveryData` from `mockData.ts` — Mon–Sun). 5 lines: Delivered (green), In Transit (blue), Pending (yellow), Delayed (red dashed), Cancelled (gray dashed). Custom tooltip + custom legend.
- **Status Breakdown Pie Chart** (Recharts): **Live data** when any assignments exist; falls back to static sample data when no assignments exist. Shows Delivered / In Transit / Pending / Delayed / Cancelled slices with counts in legend.

**Note:** The line chart always shows the same static weekly data regardless of actual assignments.

---

## COMPONENT — DeliveryTable (Dual-mode)
**File:** `/src/app/components/admin/DeliveryTable.tsx`

### Mode 1: Recent Activities (when `fullView === false` — used on Dashboard)
**Displayed Data:**
- Up to 6 most recent items combining `assignments` + `completed`
- Per row: truck avatar, truck plate + driver name, destination + company icons, status badge, date
- Empty state with "No recent activity" message

### Mode 2: Full Deliveries Table (when `fullView === true` — used on Deliveries nav)

**Input Fields:**
| Field | Type | Notes |
|---|---|---|
| Search | Text | Searches across: truck plate, assignment ID, driver name, destination, company, task status |
| Period filter | Select dropdown | Options: All Time, Today, This Month, This Year |

**Buttons:**
| Button | Action |
|---|---|
| Active tab | Shows active assignments table |
| Completed tab | Shows completed deliveries table |
| X on search | Clears search |

**Displayed Data:**
- Active table columns: TRUCK # (with ID sub-text), DRIVER, ROUTE (with remarks), CUSTOMER, STATUS badge, DATE (delivery date + assigned-at time)
- Completed table columns: TRUCK #, DRIVER, ROUTE, CUSTOMER, DELIVERY DATE, COMPLETED AT (green badge)
- Search result count + highlighted matched text (`<mark>` yellow)
- Row count badges on each tab button
- Empty state messages vary for "no results" vs "no data" vs "filtered empty"

**Conditional Logic:**
- `matchesPeriod()` filters by `deliveryDate` for active; `deliveryDate` for completed
- Search highlight rendered via `Highlight` component (case-insensitive)
- Filtered + no-data states have different instructional messages

---

## ADMIN NAV — Monitor View
**Rendered by:** `renderContent()` when `activeNav === 'Monitor'`

## COMPONENT — DriversManagement
**File:** `/src/app/components/admin/DriversManagement.tsx`

**Input Fields (main page):**
| Field | Type | Notes |
|---|---|---|
| Search | Text | Searches: truck plate, assignment ID, driver name, destination, company, task status |

**Buttons (main page):**
| Button | Action | Condition |
|---|---|---|
| Assign Task | Opens Assign Task modal | Hidden if `isViewOnly` |
| View Details | Opens View Details modal for that assignment | Per assignment card |
| Monitor (toggle) | Expands/collapses inline Monitor Panel | Per assignment card |
| Clear Search | Resets search to `''` | Only shown when search has no results |

**Displayed Data (assignment cards):**
- Truck plate (large, bold), assignment ID, status badge
- Driver name, route/destination, company, delivery date
- Document progress bar (approved count / total, green fill)
- "X approved · Y uploaded" or "Z pending upload" label

**Monitor Panel (expanded inline below cards):**
- Table row: Truck #, Driver, Route (with remarks), Customer, Status badge, Delivery Date
- Document summary: count approved, count pending review, count awaiting upload
- "Manage Documents →" link → opens View Details modal

**Completed Deliveries section (below active):**
- Shown only when `completed.length > 0`
- Table: Truck #, Driver, Route, Customer, Date, Completed At (green badge)

---

### Sub-component: Assign Task Modal

**Input Fields:**
| Field | Type | Required | Notes |
|---|---|---|---|
| Driver Name | Select dropdown | ✅ | Only shows unassigned drivers |
| Truck | Select dropdown | ✅ | Only shows `Available` trucks |
| Route | Text | ✅ | Placeholder: "e.g. Makati City → Pasig City" |
| Client | Text | ✅ | Placeholder: "e.g. ABC Retail Corp" |
| Pickup Location | Text | ✅ | Placeholder: "e.g. Warehouse A, Valenzuela City" |
| Delivery Date | Custom DatePicker (Month/Day/Year selects) | ✅ | Past dates disabled; if today, times must be future |
| Picked Up Date | Custom DatePicker | ❌ Optional | |
| Pickup Time | Custom TimePicker (HH / MM / AM·PM selects) | ✅ | |
| ETA | Custom TimePicker | ✅ | |
| ATA | Custom TimePicker | ✅ | |
| Remarks | Text | ❌ Optional | |

**Buttons:**
| Button | Action |
|---|---|
| ✕ / backdrop | Closes modal, resets all fields |
| Assign Task | Validates + creates assignment |

**Validation Rules:**
- All required fields must be filled
- Delivery date cannot be in the past
- If delivery date is today, all times must be in the future
- Shows inline error messages per field on validation failure
- Warns "All drivers are currently assigned" or "No trucks available"

**On Success:**
- Creates new `Assignment` with `id: ASN[timestamp-5]`, all 6 document types pre-loaded as `{ uploaded: false, docStatus: 'pending' }`, `taskStatus: 'Assigned'`, `assignedAt` timestamp
- Sets driver status to `'Assigned'`, truck status to `'Assigned'`

---

### Sub-component: View Details Modal (wide, 3xl)

**Displayed Data:**
- Driver profile card: avatar, name, ID, phone, location, status badge
- Assignment Details grid (11 fields): Truck #, Route, Client, Pickup Location, Pick Up Time, Picked Up Date, Delivery Date, ETA, ATA, Assigned At, Remarks
- Info note: "Delivery status is updated by the driver from their mobile view."
- **Status Photos table** (if any): shows "Picked Up" and "In Transit" rows with status badge, captured timestamp, location (+ GPS coords if available), "View" button
- **Delay Reports** (if any): amber cards with type, time, reason text
- **Issue Reason** (if `Failed / Issue`): red card with reason text
- **Documents list**: per document type — Approve / Reject / View buttons when pending; status badge when approved/rejected; rejection reason text when rejected

**Buttons:**
| Button | Action | Condition |
|---|---|---|
| View (per uploaded doc) | Opens `ImagePreviewModal` | If `fileUrl` exists |
| Approve | Sets `docStatus: 'approved'` | When `docStatus === 'pending'` and not view-only |
| Reject | Expands inline reject reason input | When `docStatus === 'pending'` and not view-only |
| Cancel (reject) | Collapses reject reason input | — |
| Confirm Reject | Sets `docStatus: 'rejected'` with reason | Disabled until reason typed |
| Mark as Complete | Calls `handleComplete(id)` → moves to `completed[]`, frees driver+truck | Only shown when ALL documents are approved and not view-only |
| Cancel Assignment | Shows inline confirmation | Not view-only |
| Keep It / Yes, Cancel | Confirms or aborts cancellation | — |

**Conditional Logic:**
- "Mark as Complete" button only appears if **every** document has `docStatus === 'approved'`
- If not all approved: amber warning "All documents must be approved before marking as complete"
- `isViewOnly` hides all Approve/Reject/Complete/Cancel actions; shows "Pending" label instead
- `handleComplete`: moves assignment to `completed[]` with `completedAt` timestamp, removes from `assignments[]`, sets driver to `'Complete'`, sets truck to `'Available'`
- `handleCancel`: moves to `cancelled[]` with `taskStatus: 'Cancelled'`, removes from `assignments[]`, sets driver to `'Pending'`, sets truck to `'Available'`

### Sub-component: ImagePreviewModal
- Shows image (`<img>`) or PDF (`<iframe>`) depending on data URL type
- "Download file" link

---

## ADMIN NAV — Deliveries View
**Component:** `DeliveryTable` with `fullView={true}` — same as described above, full table mode.

---

## ADMIN NAV — Documents View

## COMPONENT — Document Archive
**File:** `/src/app/components/admin/DocumentArchive.tsx`

**Input Fields:**
| Field | Type | Notes |
|---|---|---|
| Search | Text | Searches: assignment ID, driver name, truck plate, document type |

**Buttons:**
| Button | Action |
|---|---|
| All / Pending / Approved / Rejected chips | Sets `filter` state |
| Expand all / Collapse all | Toggles all rows open/closed |
| Assignment row (click) | Toggles that row's document sub-table |
| View (per document) | Opens `ImagePreviewModal` |
| Show all | Resets filter to `'all'` |
| Clear Search | Clears search |

**Displayed Data:**
- Top-level table columns: Assignment (chevron + ID + "Done" badge if completed), Driver, Truck, Date, Docs summary (count + approved/pending/rejected pills)
- Expanded sub-rows: Document name, Status badge, Rejection reason (if rejected), View/File button
- Filter chip counts (All: N, Pending: N, Approved: N, Rejected: N)
- Footer: assignment count + active filter label
- Empty states: "No documents uploaded yet" / "No [filter] documents" / "No results for [search]"

**Conditional Logic:**
- Only assignments/completed with at least 1 uploaded document are shown
- Sub-rows with `docStatus === 'rejected'` highlighted red, approved → light green, pending → light amber
- Rejection reason shown with `AlertCircle` icon when `docStatus === 'rejected' && rejectReason`
- File shown only if `fileUrl` exists and not `'[image-data-stripped]'`
- `useMemo` recomputes groups whenever `assignments`, `completed`, or search changes

---

## ADMIN NAV — Reports View

## COMPONENT — Reports
**File:** `/src/app/components/admin/Reports.tsx`

**Displayed Data (main page — 3 report cards):**
| Report | Description | Live KPIs shown |
|---|---|---|
| Weekly Performance | All deliveries with timing data | Total, On Time/Done, Delayed, Active |
| Monthly Delivery Summary | Grouped by calendar month | Total, On-Time, Delayed, Cancelled |
| Delay & Issues | All delay reports from all assignments | Total incidents, Resolved, Ongoing |

**Displayed Data (summary stats on main page):**
- Total Deliveries, Completed Deliveries, On-Time Rate (%), Active Assignments, Total Delay Incidents
- **Delay Reason Breakdown** horizontal bar chart: counts by type (Pickup Delay, Delivery Delay, Client Issue, Weather, Document Issue, Vehicle Issue)

**Buttons:**
| Button | Action |
|---|---|
| Preview (per report card) | Opens full-screen `PreviewModal` |

### Sub-component: PreviewModal

**Displayed Data:**
- Report title + "Generated [date]"
- Summary stats grid (4 cards) — data varies by report type
- Full scrollable data table

**Buttons:**
| Button | Action |
|---|---|
| ✕ / Close | Closes modal |
| Print / PDF | Calls `window.print()` |
| Export CSV | Generates and downloads `.csv` file via `downloadCSV()` |

**Report Tables:**
- **Weekly:** Columns: Date, Driver, Truck #, Route (pickup → destination), Client, Pickup Time, ETA, ATA, Status badge
- **Monthly:** Columns: Month, Total Deliveries, On-Time (with mini bar), Delayed, Cancelled, Completion Rate (%; green ≥ 90%, amber otherwise); totals row shown when > 1 month
- **Delay:** Columns: Date, Driver, Truck #, Route, Client, Scheduled Time, Reported At, Issue Type badge, Reason for Delay, Status (Resolved/Ongoing)

---

## ADMIN NAV — Accounts View

## COMPONENT — AccountsPanel
**File:** `/src/app/components/admin/AccountsPanel.tsx`

**Tabs:** Drivers | Trucks (with count badges)

**Header Buttons:**
| Button | Condition |
|---|---|
| Reset All Data (red) | Hidden if `isViewOnly` or `onResetAll` not provided |
| Drivers tab | Always |
| Trucks tab | Always |

### Drivers Tab

**Displayed Data (table):**
- Columns: Driver (avatar + name + ID), Contact (phone link), Availability badge (Available/Unavailable), PIN (blurred, hold-to-reveal), Action buttons
- Availability: "Unavailable" = driver has active assignment; "Available" = all other statuses
- PIN: held with mouse/touch to reveal; auto-hides on release/mouse-leave
- Empty state: "No Drivers Registered Yet" + Register Driver button

**Buttons per row:**
| Button | Action | Condition |
|---|---|---|
| New PIN | Generates new random 4-digit PIN for that driver | Not view-only |
| Delete | Opens delete confirmation modal | Not view-only |

**Status note:** "Status is Unavailable when the driver has an active task. Hold the eye icon to reveal a PIN."

### Trucks Tab

**Displayed Data (table):**
- Columns: Plate Number (mono font + ID), Classification, Payload Capacity (blue badge), Status (Available/Unavailable)
- Empty state: "No Trucks Registered Yet" + Register Truck button

---

### Sub-component: Register Driver Modal

**Input Fields:**
| Field | Type | Validation |
|---|---|---|
| Surname | Text | Required |
| First Name | Text | Required |
| Mobile Number (+63 prefix) | Numeric (10 digits) | Must be exactly 10 digits after +63 |
| PIN | Auto-generated (4-digit display) | Must generate before registering |

**Buttons:**
| Button | Action |
|---|---|
| Generate / Regenerate PIN | Generates `Math.floor(1000 + random * 9000)` |
| Cancel | Closes modal, resets all fields |
| Register Driver | Validates + creates driver record |

**Success State:**
- Shows green checkmark with "Registered!" message
- Displays credentials card: Surname, First Name, PIN (in mono font)
- "Done" button closes modal

**Driver ID format:** `DR[last 5 digits of Date.now()]`

---

### Sub-component: Delete Driver Confirmation Modal
- Shows driver name + ID in red card
- "Are you sure you want to permanently remove [name]?"
- Cancel / "Yes, Delete" (red) buttons
- On confirm: `setDrivers(p => p.filter(d => d.id !== target.id))`

---

### Sub-component: Register Truck Modal

**Input Fields:**
| Field | Type | Validation |
|---|---|---|
| Plate Letters | Text (3 letters, auto-uppercase) | Exactly 3 letters; auto-focuses numbers field when complete |
| Plate Numbers | Numeric (3–4 digits) | Digits only |
| Truck Classification | Grid of 8 toggle buttons | Required |
| Payload Capacity | List of 7 radio-style buttons | Required |

**Classifications:** Pickup Truck, Closed Van, Wing Van, Boom Truck, Semi-Trailer, Refrigerated Van, Flatbed Truck, Tanker

**Capacities:** Up to 500 kg, 500–1,000 kg, 1,000–2,000 kg, 2,000–5,000 kg, 5,000–10,000 kg, 10,000–20,000 kg, 20,000 kg and above

**Buttons:**
| Button | Action |
|---|---|
| Cancel | Closes + resets |
| Register Truck | Validates; checks for duplicate plate |

**Success State:** Shows truck details card (plate, classification, capacity); "Done" closes modal

**Truck ID format:** `T[last 5 digits of Date.now()]`

---

### Sub-component: Reset All Data Confirmation Modal

**Displayed Data:**
- Alert triangle icon (red)
- "This will permanently delete all **drivers**, **trucks**, **assignments**, and history from the database."
- "Admin accounts are NOT affected. This cannot be undone."

**Buttons:**
| Button | Action |
|---|---|
| Cancel | Closes modal |
| Yes, Reset (red) | Calls `handleConfirmReset()` → calls `onResetAll()` |

**States:**
- Loading: spinner + "Resetting…"
- Success: green checkmark + "All Data Cleared" message → auto-closes after 2 seconds

**`onResetAll` logic (in `App.tsx`):** Calls `POST /reset-data` on the server (sets all 6 KV keys to `[]`), then clears all local state arrays. Sets `isPollUpdate.current = true` to prevent the state-change from triggering auto-save.

---

## PAGE 3 — Driver Interface
**File:** `/src/app/components/driver/DriverInterface.tsx`
**Route:** Shown when `view === 'driver'`

### Startup States

| State | What's Shown |
|---|---|
| Loading (syncing, no data yet) | Spinner + "Loading your tasks…" + "Welcome, [name]" |
| Offline + no data | `WifiOff` icon, "No Connection", Try Again button, "Preview with demo data" link, Logout link |
| Offline + has data | Full UI with yellow "Preview Mode" banner |

### Sticky Header
**Displayed Data:**
- Teal truck icon + "360 Logistics" label + driver name + truck plate badge (if assigned)
- Connection indicator: "● Live" (green pulse) or "WifiOff Offline" (red)
- "Last synced: HH:MM:SS" (if ever synced)
- Preview Mode banner (amber, when offline)
- Progress bar at top of screen while `updating`

**Buttons:**
| Button | Action |
|---|---|
| Refresh icon | Calls `fetchData()` manually |
| Logout icon | Opens logout confirmation bottom sheet |

### Main Content Area

#### No Active Assignment State
- "No Active Delivery" card with Package icon
- "Checking every 5 seconds…" row
- Delivery History section (if any history exists)

#### Active Assignment State

**Status Card:**
- Assignment ID header + current status badge
- **Progress Stepper** (if not Failed/Cancelled): 4 steps: Assigned → Picked Up → In Transit → Delivered. Done steps show green checkmark; active step highlighted in primary.
- Failed/Cancelled banner with issue reason (if any)

**Overdue Warning:**
- Red banner "Delivery Overdue" shown if `deliveryDate` is past today and not yet delivered/failed

**Forced Delay Prompts (blocking):**
- **Pickup delay prompt:** Shown when `taskStatus === 'Assigned'` AND current time is past `pickupTime` AND no pickup delay report exists yet
- **Delivery delay prompt:** Shown when `taskStatus === 'In Transit'` AND current time is past `ata` AND no delivery delay report exists yet
- Both prompt buttons: `Report Pickup Delay` / `Report Delivery Delay` → opens `ReasonSheet`

**Delivery Details card:**
| Info Row | Data |
|---|---|
| Truck Plate | — |
| Cargo / Item | `destination` field (highlighted) |
| Pickup Location | — |
| Delivery To | `company` field (highlighted) |
| Picked Up Date | Shown only if set |
| Delivery Date | — |
| Pickup Time | — |
| Arrival Time (ATA) | Shown only if set |
| Est. Time (ETA) | Shown only if set |
| Remarks / Instructions | Shown only if set |

**Delay Reports history:** Amber cards showing type, reported-at, reason for each delay

**Report Problem button:** `AlertTriangle` → opens Issue ReasonSheet. Hidden when Delivered/Failed/Cancelled.

**Documents Section (collapsible):**
- Toggle header: "X/Y uploaded · Z approved"
- "After delivery" pill shown while not yet delivered
- When not delivered: amber notice "Upload is unlocked after marking as Delivered"
- Per document: icon (color varies by status), doc type name, status chip
  - `DocChip` states: "Not uploaded" (gray), "Pending review" (amber), "Approved ✓" (green), "Rejected — re-upload" (red with rejection reason)
- **Upload / Re-upload button:** Shown only when `isDelivered && (!uploaded || rejected)`. Triggers hidden file input; accepts image/* and PDF

**Sticky Bottom Action Button:**
- Shows "Mark as [next status]" with arrow
- If delay prompt is pending: greyed "Report Delay First" (disabled)
- Statuses requiring photo before advancing: `'Picked Up'`, `'In Transit'` → opens `PhotoSheet`
- `'Delivered'` status → opens `DeliveredSheet`
- All other advances → calls `pushUpdate({ taskStatus: nextStatus })` directly
- Hidden when Delivered / Failed / Cancelled

---

### Sub-component: PhotoSheet (bottom sheet)

**Displayed Data:**
- "Photo Required" heading + status label
- Camera/gallery file input (hidden; triggered by tap target)
- After photo taken: preview image + "Retake" X button
- Location loading spinner → then green metadata card showing Timestamp + Location (GPS reverse-geocoded via Nominatim API)

**Buttons:**
| Button | Action |
|---|---|
| Take a Photo area | Opens `input[type=file capture=environment]` |
| X on preview | Clears photo + metadata |
| Confirm — [Status label] | Disabled until photo taken + location resolved; calls `onConfirm(photo)` |
| X (header) / backdrop | Calls `onCancel()` |

**Logic:**
- Image compressed to max 600px, JPEG 65% quality via canvas
- GPS coordinates retrieved via `navigator.geolocation` (10-second timeout)
- Reverse geocoded via Nominatim OpenStreetMap API → human-readable location label
- On confirm: uploads to Supabase Storage via `POST /upload-image`; falls back to local data-URL if upload fails
- Sends notification: `type: 'status_update'`, `navigateTo: 'Monitor'`

---

### Sub-component: ReasonSheet (bottom sheet — used for delays & issues)

**Input Fields:**
| Field | Type | Notes |
|---|---|---|
| Reason | Select dropdown | Options vary by type |
| Custom reason | Textarea (autoFocus) | Only shown when "Other..." selected |

**Pickup Delay Reasons:** Heavy traffic, Vehicle breakdown, Waiting for cargo, Weather conditions, Driver health issue, Other...

**Delivery Delay Reasons:** Heavy traffic, Wrong address / rerouting, Customer unavailable, Vehicle breakdown, Weather conditions, Other...

**Issue / Problem Reasons:** Cargo damaged in transit, Wrong delivery address, Customer refused delivery, Vehicle breakdown, Cargo lost or missing, Accident / road incident, Other...

**Buttons:**
| Button | Action |
|---|---|
| Cancel | Closes sheet |
| Submit | Disabled until reason selected (or "Other…" with text); calls `onSubmit(reason)` |

**Colors:** `amber` variant for delays; `red` variant for issues

**On delay submit:** Adds to `delayReports[]` array + sends notification (`type: 'delay_report'`, `navigateTo: 'Monitor'`)
**On issue submit:** Sets `taskStatus: 'Failed / Issue'` + `issueReason` + sends notification (`type: 'issue_report'`, `navigateTo: 'Monitor'`)

---

### Sub-component: DeliveredSheet (confirmation bottom sheet)

- Green checkmark icon
- "Confirm Delivery — Mark as Delivered? This action cannot be undone."
- "Not yet" / "Yes, Delivered!" buttons
- On confirm: sets `taskStatus: 'Delivered'` + sends notification + auto-opens documents section (`setDocsOpen(true)`)

---

### Sub-component: Logout Confirmation (bottom sheet)
- "Log out of Driver Portal?" text
- Cancel / Log Out (red) buttons

---

### Sub-component: Delivery History Section (collapsible)
- Toggle header: "Delivery History — X completed deliveries"
- Per item: assignment ID (mono), truck plate, cargo/destination, company, delivery date, completed-at timestamp with green checkmark

---

## SUPPORTING COMPONENTS (legacy / not in active navigation)

### ActivityLog.tsx
- Uses **static mock data** (`mockActivities` from `mockData.ts`) — **not connected** to any live state
- Not rendered in `AdminDashboard.renderContent()` — unreachable from current nav
- Would display: recent activities list (action icon + color by type), stats cards (24 doc uploads, 58 status updates, 12 driver actions — all hardcoded)
- Buttons: "Filter" and "Export Log" (no-ops), "Load More Activities →" (no-op)

### DocumentApproval.tsx
- Uses **static mock data** (`mockDocuments` from `mockData.ts`) — **not connected** to live state
- Not rendered in `AdminDashboard.renderContent()` — unreachable from current nav
- Would show pending document cards with Preview/Approve/Reject buttons (Preview opens a placeholder modal; Approve/Reject are no-ops)

---

## BACKEND SERVER
**File:** `/supabase/functions/server/index.tsx` — Hono/Deno edge function

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Returns `{ status: "ok", ts: Date.now() }` |
| `POST` | `/driver-login` | None | Validates driver name + plate + PIN against KV data |
| `GET` | `/app-data` | X-Admin-Token | Returns all 6 data arrays (falls back to `[]` if KV empty) |
| `PUT` | `/app-data` | X-Admin-Token (non-viewer) | Saves all 6 arrays to KV; strips base64 data-URLs |
| `POST` | `/reset-data` | X-Admin-Token (non-viewer) | Sets all 6 KV keys to `[]` |
| `GET` | `/driver-data?driverId=` | Bearer anon key | Returns driver record, active assignment, completed history |
| `PUT` | `/driver-update` | Bearer anon key | Smart-merges assignment update; adds notification to KV; preserves admin doc statuses |
| `POST` | `/upload-image` | Bearer anon key | Uploads base64 image to Supabase Storage bucket; returns 10-year signed URL |

### Admin Accounts (server-side)
| Email | Role |
|---|---|
| `360logistics@email.ph` | `admin` |
| `admin360logistics@gmail.ph` | `demo` |
| `admin360logistics@email.com` | `viewer` |

### Token Format
`btoa(email:role:timestamp)` — expires after 30 days

### KV Keys
`app_drivers_v1`, `app_trucks_v1`, `app_assignments_v1`, `app_completed_v1`, `app_cancelled_v1`, `app_notifications_v1`

### Initial Seed Data
Both `INITIAL_DRIVERS` and `INITIAL_TRUCKS` are now `[]` (empty — no auto-seeded test data).

---

## DATA TYPES (from `assignmentTypes.ts`)

| Type | Key Fields |
|---|---|
| `LocalDriver` | id, name, phone, truckNumber, status (Assigned/Pending/Complete), currentLocation, deliveriesToday, rating, pin?, shift? |
| `LocalTruck` | id, plateNumber, status (Available/Assigned), classification?, capacity? |
| `Assignment` | id, driverName, driverId, truckPlate, truckId, destination, company, pickupLocation, pickupTime, pickedUpDate, eta, ata, deliveryDate, remarks, taskStatus, documents[], assignedAt, statusPhotos?, issueReason?, delayReports? |
| `CompletedTask` | extends Assignment + completedAt |
| `AssignmentDoc` | type, uploaded, docStatus (pending/approved/rejected), fileUrl?, rejectReason? |
| `StatusPhoto` | url, timestamp, location, coords? |
| `DelayReport` | type (pickup/delivery), reason, reportedAt |
| `AppNotification` | id, type (doc_upload/status_update/delay_report/issue_report), message, assignmentId, driverName, truckPlate, docType?, statusUpdate?, photoUrl?, reason?, read, timestamp, navigateTo? |
| `AdminRole` | `'admin'` \| `'demo'` \| `'viewer'` |

### Task Status Flow
`Assigned` → `Picked Up` → `In Transit` → `Delivered`
(or `Failed / Issue` at any non-terminal point; `Cancelled` by admin only)

### Document Types (6, fixed per assignment)
1. Proof of Delivery
2. Receiving Acknowledgement Report
3. Dispatch Slip
4. Sales Invoice
5. Bill of Lading
6. Waybill / Delivery Receipt

---

## FILE STRUCTURE SUMMARY

```
/src/app/
├── App.tsx                          # Root — session + state + auto-save + polling
├── components/
│   ├── auth/
│   │   └── LoginScreen.tsx          # Driver + Admin login (dual sub-view)
│   ├── admin/
│   │   ├── AdminDashboard.tsx       # Shell + nav router
│   │   ├── Sidebar.tsx              # Left nav (6 items + logout)
│   │   ├── Header.tsx               # Top bar + notifications dropdown
│   │   ├── KPICards.tsx             # 6 live metric cards
│   │   ├── DeliveryStatusBoard.tsx  # 6 status columns + progress bar
│   │   ├── Charts.tsx               # Line chart + Pie chart (Recharts)
│   │   ├── DeliveryTable.tsx        # Recent Activities widget + full table
│   │   ├── DriversManagement.tsx    # Assignment cards + Assign/View/Monitor modals
│   │   ├── DocumentArchive.tsx      # Accordion doc table with filters
│   │   ├── Reports.tsx              # 3 report cards + PreviewModal + CSV export
│   │   ├── AccountsPanel.tsx        # Driver/Truck registration + Reset All
│   │   ├── ActivityLog.tsx          # LEGACY — static mock data, not in nav
│   │   └── DocumentApproval.tsx     # LEGACY — static mock data, not in nav
│   ├── driver/
│   │   └── DriverInterface.tsx      # Full mobile driver UI + all bottom sheets
│   ├── figma/
│   │   └── ImageWithFallback.tsx    # Protected — do not modify
│   └── ui/                          # Shared UI primitives (if any)
├── data/
│   ├── assignmentTypes.ts           # All shared TypeScript interfaces + status configs
│   └── mockData.ts                  # Static mock deliveries/drivers/docs/activities
└── lib/
    └── supabaseClient.ts            # Supabase client + SERVER URL constant
```
