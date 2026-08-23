<?php
// 360 Logistics API Endpoints
// ==============================================

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Admin-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once 'config.php';
require_once 'db.php';

// Initialize database
initializeDatabase();

// Get request path and method
$requestUri = $_SERVER['REQUEST_URI'];
$requestMethod = $_SERVER['REQUEST_METHOD'];
$path = parse_url($requestUri, PHP_URL_PATH);
$path = str_replace('/api.php', '', $path);

// Helper: Get JSON input
function getJsonInput() {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

// Helper: Verify admin token
function verifyAdminToken() {
    global $ADMIN_ACCOUNTS;
    
    $token = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    if (empty($token)) {
        return null;
    }
    
    try {
        $decoded = base64_decode($token);
        $parts = explode(':', $decoded);
        
        if (count($parts) < 3) {
            return null;
        }
        
        $email = $parts[0];
        $role = $parts[1];
        $timestamp = intval($parts[2]);
        
        // Check if token expired (30 days)
        if ((time() * 1000 - $timestamp) > SESSION_LIFETIME * 1000) {
            return null;
        }
        
        // Verify account exists
        foreach ($ADMIN_ACCOUNTS as $account) {
            if ($account['email'] === $email && $account['role'] === $role) {
                return ['email' => $email, 'role' => $role];
            }
        }
        
        return null;
    } catch (Exception $e) {
        return null;
    }
}

// Helper: Send JSON response
function sendJson($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data);
    exit;
}

// ============================================
// ROUTES
// ============================================

// Health Check
if ($path === '/health' && $requestMethod === 'GET') {
    sendJson(['status' => 'ok', 'timestamp' => time() * 1000]);
}

// Driver Login
if ($path === '/driver-login' && $requestMethod === 'POST') {
    $input = getJsonInput();
    
    $surname = trim($input['surname'] ?? '');
    $firstName = trim($input['firstName'] ?? '');
    $plateLetters = strtoupper(trim($input['plateLetters'] ?? ''));
    $plateNumbers = trim($input['plateNumbers'] ?? '');
    $pin = trim($input['pin'] ?? '');
    
    if (empty($surname) || empty($firstName)) {
        sendJson(['error' => 'driver_not_found', 'msg' => 'Please enter both surname and first name.'], 400);
    }
    
    $fullName = trim("$firstName $surname");
    $fullPlate = "$plateLetters $plateNumbers";
    
    $drivers = kvGet('app_drivers_v1') ?? $GLOBALS['INITIAL_DRIVERS'];
    $trucks = kvGet('app_trucks_v1') ?? $GLOBALS['INITIAL_TRUCKS'];
    $assignments = kvGet('app_assignments_v1') ?? [];
    
    // Find driver
    $driver = null;
    foreach ($drivers as $d) {
        if (strcasecmp(trim($d['name']), $fullName) === 0) {
            $driver = $d;
            break;
        }
    }
    
    if (!$driver) {
        sendJson(['error' => 'driver_not_found', 'msg' => "\"$fullName\" is not a registered driver. Contact your admin."], 401);
    }
    
    // Find truck
    $truck = null;
    foreach ($trucks as $t) {
        $serverPlate = str_replace(' ', '', strtoupper($t['plateNumber']));
        $inputPlate = str_replace(' ', '', strtoupper($fullPlate));
        if ($serverPlate === $inputPlate) {
            $truck = $t;
            break;
        }
    }
    
    if (!$truck) {
        sendJson(['error' => 'truck_not_found', 'msg' => "Truck \"$fullPlate\" is not registered. Contact your admin."], 401);
    }
    
    // Check if truck is assigned to another driver
    foreach ($assignments as $a) {
        $assignedPlate = str_replace(' ', '', strtoupper($a['truckPlate'] ?? ''));
        $inputPlate = str_replace(' ', '', strtoupper($fullPlate));
        
        if ($assignedPlate === $inputPlate && 
            in_array($a['taskStatus'], ['Assigned', 'Picked Up', 'In Transit'])) {
            if (strcasecmp($a['driverName'] ?? '', $fullName) !== 0) {
                sendJson(['error' => 'truck_taken', 'msg' => "This truck is currently assigned to {$a['driverName']}. Contact your admin."], 401);
            }
        }
    }
    
    // Verify PIN
    if (!empty($driver['pin']) && $driver['pin'] !== $pin) {
        sendJson(['error' => 'wrong_pin', 'msg' => 'Incorrect PIN. Try again or contact your admin.'], 401);
    }
    
    sendJson(['success' => true, 'driverId' => $driver['id'], 'driverName' => $driver['name']]);
}

// Get App Data (Admin)
if ($path === '/app-data' && $requestMethod === 'GET') {
    $user = verifyAdminToken();
    if (!$user) {
        sendJson(['error' => 'Unauthorized'], 401);
    }
    
    $drivers = kvGet('app_drivers_v1') ?? $GLOBALS['INITIAL_DRIVERS'];
    $trucks = kvGet('app_trucks_v1') ?? $GLOBALS['INITIAL_TRUCKS'];
    $assignments = kvGet('app_assignments_v1') ?? [];
    $completed = kvGet('app_completed_v1') ?? [];
    $cancelled = kvGet('app_cancelled_v1') ?? [];
    $notifications = kvGet('app_notifications_v1') ?? [];
    
    sendJson([
        'drivers' => $drivers,
        'trucks' => $trucks,
        'assignments' => $assignments,
        'completed' => $completed,
        'cancelled' => $cancelled,
        'notifications' => $notifications,
        'role' => $user['role']
    ]);
}

// Save App Data (Admin)
if ($path === '/app-data' && $requestMethod === 'PUT') {
    $user = verifyAdminToken();
    if (!$user) {
        sendJson(['error' => 'Unauthorized'], 401);
    }
    
    if ($user['role'] === 'viewer') {
        sendJson(['error' => 'Read-only access — cannot save data'], 403);
    }
    
    $input = getJsonInput();
    
    kvSet('app_drivers_v1', stripBase64($input['drivers'] ?? []));
    kvSet('app_trucks_v1', stripBase64($input['trucks'] ?? []));
    kvSet('app_assignments_v1', stripBase64($input['assignments'] ?? []));
    kvSet('app_completed_v1', stripBase64($input['completed'] ?? []));
    kvSet('app_cancelled_v1', stripBase64($input['cancelled'] ?? []));
    kvSet('app_notifications_v1', stripBase64($input['notifications'] ?? []));
    
    sendJson(['success' => true]);
}

// Get Driver Data
if ($path === '/driver-data' && $requestMethod === 'GET') {
    $driverId = $_GET['driverId'] ?? '';
    
    if (empty($driverId)) {
        sendJson(['error' => 'driverId required'], 400);
    }
    
    $drivers = kvGet('app_drivers_v1') ?? $GLOBALS['INITIAL_DRIVERS'];
    $trucks = kvGet('app_trucks_v1') ?? $GLOBALS['INITIAL_TRUCKS'];
    $assignments = kvGet('app_assignments_v1') ?? [];
    $completed = kvGet('app_completed_v1') ?? [];
    
    // Find driver
    $driver = null;
    foreach ($drivers as $d) {
        if ($d['id'] === $driverId) {
            $driver = $d;
            break;
        }
    }
    
    if (!$driver) {
        sendJson(['error' => 'Driver not found'], 404);
    }
    
    // Find active assignment
    $active = null;
    foreach ($assignments as $a) {
        if ($a['driverId'] === $driverId && 
            !in_array($a['taskStatus'], ['Delivered', 'Failed / Issue', 'Cancelled'])) {
            $active = $a;
            break;
        }
    }
    
    // Find most recent terminal assignment (Delivered/Failed)
    $terminal = null;
    $terminalAssignments = array_filter($assignments, function($a) use ($driverId) {
        return $a['driverId'] === $driverId && 
               in_array($a['taskStatus'], ['Delivered', 'Failed / Issue']);
    });
    
    usort($terminalAssignments, function($a, $b) {
        return strcmp($b['assignedAt'] ?? '', $a['assignedAt'] ?? '');
    });
    
    if (count($terminalAssignments) > 0) {
        $terminal = $terminalAssignments[0];
    }
    
    $assignment = $active ?? $terminal ?? null;
    
    // Get completed history
    $completedHistory = array_filter($completed, function($c) use ($driverId) {
        return $c['driverId'] === $driverId;
    });
    
    usort($completedHistory, function($a, $b) {
        return strcmp($b['completedAt'] ?? '', $a['completedAt'] ?? '');
    });
    
    $completedHistory = array_map(function($c) {
        return [
            'id' => $c['id'],
            'destination' => $c['destination'],
            'company' => $c['company'],
            'deliveryDate' => $c['deliveryDate'],
            'completedAt' => $c['completedAt'],
            'truckPlate' => $c['truckPlate'],
            'taskStatus' => $c['taskStatus']
        ];
    }, array_values($completedHistory));
    
    sendJson([
        'driver' => $driver,
        'assignment' => $assignment,
        'trucks' => $trucks,
        'completedHistory' => $completedHistory
    ]);
}

// Update Driver Data
if ($path === '/driver-update' && $requestMethod === 'PUT') {
    $input = getJsonInput();
    
    $driverId = $input['driverId'] ?? '';
    $assignmentId = $input['assignmentId'] ?? '';
    $updates = $input['updates'] ?? [];
    $notif = $input['notif'] ?? null;
    
    if (empty($driverId) || empty($assignmentId) || empty($updates)) {
        sendJson(['error' => 'missing fields'], 400);
    }
    
    $drivers = kvGet('app_drivers_v1') ?? $GLOBALS['INITIAL_DRIVERS'];
    $assignments = kvGet('app_assignments_v1') ?? [];
    
    // Find driver
    $driver = null;
    foreach ($drivers as $d) {
        if ($d['id'] === $driverId) {
            $driver = $d;
            break;
        }
    }
    
    if (!$driver) {
        sendJson(['error' => 'Driver not found'], 401);
    }
    
    // Strip base64 from updates
    $safeUpdates = stripBase64($updates);
    
    // Update assignment with smart document merge
    $updatedAssignments = [];
    foreach ($assignments as $a) {
        if ($a['id'] === $assignmentId) {
            // Smart document merge
            if (isset($safeUpdates['documents']) && isset($a['documents'])) {
                $mergedDocs = [];
                foreach ($a['documents'] as $serverDoc) {
                    $driverDoc = null;
                    foreach ($safeUpdates['documents'] as $doc) {
                        if ($doc['type'] === $serverDoc['type']) {
                            $driverDoc = $doc;
                            break;
                        }
                    }
                    
                    if ($driverDoc) {
                        $newFileUrl = $driverDoc['fileUrl'] ?? '';
                        $hasNewFile = !empty($newFileUrl) && 
                                     $newFileUrl !== '[image-data-stripped]' && 
                                     $newFileUrl !== ($serverDoc['fileUrl'] ?? '');
                        
                        if ($hasNewFile) {
                            // New file uploaded - reset to pending
                            $mergedDocs[] = array_merge($serverDoc, [
                                'uploaded' => true,
                                'fileUrl' => $newFileUrl,
                                'docStatus' => 'pending'
                            ]);
                        } else {
                            // No new file - preserve server state
                            $mergedDocs[] = $serverDoc;
                        }
                    } else {
                        $mergedDocs[] = $serverDoc;
                    }
                }
                $safeUpdates['documents'] = $mergedDocs;
            }
            
            $updatedAssignments[] = array_merge($a, $safeUpdates);
        } else {
            $updatedAssignments[] = $a;
        }
    }
    
    kvSet('app_assignments_v1', $updatedAssignments);
    
    // Add notification if provided
    if ($notif) {
        $notifications = kvGet('app_notifications_v1') ?? [];
        $newNotif = array_merge([
            'id' => 'notif-' . time() . '-' . substr(uniqid(), -4),
            'read' => false,
            'timestamp' => date('M j, g:i A'),
            'driverName' => $driver['name']
        ], $notif);
        
        array_unshift($notifications, $newNotif);
        kvSet('app_notifications_v1', $notifications);
    }
    
    sendJson(['success' => true]);
}

// Upload Image
if ($path === '/upload-image' && $requestMethod === 'POST') {
    $input = getJsonInput();
    
    $data = $input['data'] ?? '';
    $path = $input['path'] ?? '';
    
    if (empty($data) || empty($path)) {
        sendJson(['error' => 'data and path are required'], 400);
    }
    
    try {
        // Extract base64 data
        if (strpos($data, ',') !== false) {
            list($type, $base64Data) = explode(',', $data, 2);
        } else {
            $base64Data = $data;
        }
        
        // Decode and save
        $imageData = base64_decode($base64Data);
        $filePath = UPLOAD_DIR . $path;
        
        // Create directory if needed
        $dir = dirname($filePath);
        if (!file_exists($dir)) {
            mkdir($dir, 0777, true);
        }
        
        file_put_contents($filePath, $imageData);
        
        // Return URL
        $url = '/uploads/' . $path;
        sendJson(['url' => $url]);
        
    } catch (Exception $e) {
        sendJson(['error' => 'Upload failed: ' . $e->getMessage()], 500);
    }
}

// Default 404
sendJson(['error' => 'Not found'], 404);
?>
