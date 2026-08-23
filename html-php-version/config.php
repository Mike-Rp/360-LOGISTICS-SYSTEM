<?php
// 360 Logistics Configuration
// ==============================================

// Database Configuration
define('DB_HOST', 'localhost');
define('DB_NAME', '360_logistics');
define('DB_USER', 'root');
define('DB_PASS', '');

// Application Settings
define('UPLOAD_DIR', __DIR__ . '/uploads/');
define('MAX_FILE_SIZE', 5 * 1024 * 1024); // 5MB
define('SESSION_LIFETIME', 30 * 24 * 60 * 60); // 30 days

// Admin Accounts (hardcoded as per original)
$ADMIN_ACCOUNTS = [
    [
        'email' => '360logistics@email.ph',
        'password' => '360Admin2026!',
        'role' => 'admin'
    ],
    [
        'email' => 'admin360logistics@gmail.ph',
        'password' => '360Demo2026!',
        'role' => 'demo'
    ],
    [
        'email' => 'admin360logistics@email.com',
        'password' => '360View2026!',
        'role' => 'viewer'
    ]
];

// Initial Drivers
$INITIAL_DRIVERS = [
    ['id' => 'DR001', 'name' => 'Hanna Belarmino', 'phone' => '—', 'truckNumber' => '—', 'status' => 'Pending', 'currentLocation' => '—', 'deliveriesToday' => 0, 'rating' => 0, 'pin' => '3812', 'shift' => ''],
    ['id' => 'DR002', 'name' => 'Kian Yamzon', 'phone' => '—', 'truckNumber' => '—', 'status' => 'Pending', 'currentLocation' => '—', 'deliveriesToday' => 0, 'rating' => 0, 'pin' => '5047', 'shift' => ''],
    ['id' => 'DR003', 'name' => 'Kevin Villaver', 'phone' => '—', 'truckNumber' => '—', 'status' => 'Pending', 'currentLocation' => '—', 'deliveriesToday' => 0, 'rating' => 0, 'pin' => '7293', 'shift' => ''],
    ['id' => 'DR004', 'name' => 'Mikhail Respicio', 'phone' => '—', 'truckNumber' => '—', 'status' => 'Pending', 'currentLocation' => '—', 'deliveriesToday' => 0, 'rating' => 0, 'pin' => '6154', 'shift' => '']
];

// Initial Trucks
$INITIAL_TRUCKS = [
    ['id' => 'T00001', 'plateNumber' => 'ABC 1234', 'status' => 'Available', 'classification' => 'Wing Van', 'capacity' => '10,000 kg – 20,000 kg'],
    ['id' => 'T00002', 'plateNumber' => 'DEF 5678', 'status' => 'Available', 'classification' => 'Closed Van', 'capacity' => '2,000 kg – 5,000 kg'],
    ['id' => 'T00003', 'plateNumber' => 'GHI 9012', 'status' => 'Available', 'classification' => 'Semi-Trailer', 'capacity' => '20,000 kg and above'],
    ['id' => 'T00004', 'plateNumber' => 'JKL 3456', 'status' => 'Available', 'classification' => 'Refrigerated Van', 'capacity' => '1,000 kg – 2,000 kg'],
    ['id' => 'T00005', 'plateNumber' => 'MNO 7890', 'status' => 'Available', 'classification' => 'Flatbed Truck', 'capacity' => '5,000 kg – 10,000 kg'],
    ['id' => 'T00006', 'plateNumber' => 'PQR 2345', 'status' => 'Available', 'classification' => 'Boom Truck', 'capacity' => '5,000 kg – 10,000 kg'],
    ['id' => 'T00007', 'plateNumber' => 'STU 6789', 'status' => 'Available', 'classification' => 'Pickup Truck', 'capacity' => '500 kg – 1,000 kg']
];

// Document Types
$DOCUMENT_TYPES = [
    'Proof of Delivery',
    'Receiving Acknowledgement Report',
    'Dispatch Slip',
    'Sales Invoice',
    'Bill of Lading',
    'Waybill / Delivery Receipt'
];

// Create upload directory if it doesn't exist
if (!file_exists(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0777, true);
}
?>
