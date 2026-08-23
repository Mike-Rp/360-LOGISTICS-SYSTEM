<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>360 Logistics - Login</title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body class="login-page">
    <div class="login-container">
        <div class="login-card">
            <div class="login-header">
                <img src="assets/images/logo.png" alt="360 Logistics" class="logo" onerror="this.style.display='none'">
                <h1>360 Logistics</h1>
                <p>Trucking Operations & Delivery Tracking</p>
            </div>

            <!-- Driver Login Form -->
            <div id="driverLoginForm" class="login-form active">
                <div class="form-group">
                    <label>Driver Name</label>
                    <div class="name-inputs">
                        <div>
                            <span class="label-hint">Surname</span>
                            <input type="text" id="driverSurname" placeholder="e.g. dela Cruz">
                        </div>
                        <div>
                            <span class="label-hint">First Name</span>
                            <input type="text" id="driverFirstName" placeholder="e.g. Juan">
                        </div>
                    </div>
                </div>

                <div id="nameError" class="error-banner" style="display: none;">
                    <div class="error-icon">⚠</div>
                    <div>
                        <strong>Driver Not Found</strong>
                        <p id="nameErrorMsg"></p>
                    </div>
                </div>

                <div class="form-group">
                    <label>Truck Plate Number</label>
                    <div class="plate-inputs">
                        <input type="text" id="plateLetters" placeholder="ABC" maxlength="3" class="plate-letters">
                        <span class="plate-dash">–</span>
                        <input type="text" id="plateNumbers" placeholder="8473" maxlength="4" class="plate-numbers">
                        <div id="platePreview" class="plate-preview" style="display: none;">
                            <span id="platePreviewText"></span>
                        </div>
                    </div>
                    <p class="field-hint">3 letters · 3–4 numbers</p>
                </div>

                <div id="plateError" class="error-banner" style="display: none;">
                    <div class="error-icon">🚚</div>
                    <div>
                        <strong>Truck Not Found</strong>
                        <p id="plateErrorMsg"></p>
                    </div>
                </div>

                <div class="form-group">
                    <label>4-Digit PIN</label>
                    <div class="pin-inputs">
                        <input type="password" maxlength="1" class="pin-input" data-index="0">
                        <input type="password" maxlength="1" class="pin-input" data-index="1">
                        <input type="password" maxlength="1" class="pin-input" data-index="2">
                        <input type="password" maxlength="1" class="pin-input" data-index="3">
                    </div>
                </div>

                <div id="pinError" class="error-banner" style="display: none;">
                    <div class="error-icon">🔑</div>
                    <div>
                        <strong>Incorrect PIN</strong>
                        <p id="pinErrorMsg"></p>
                    </div>
                </div>

                <div id="generalError" class="error-banner" style="display: none;">
                    <div class="error-icon">⚠</div>
                    <div>
                        <p id="generalErrorMsg"></p>
                    </div>
                </div>

                <button id="driverLoginBtn" class="btn btn-primary btn-large">
                    <span id="driverLoginText">Login</span>
                    <span id="driverLoginSpinner" class="spinner" style="display: none;"></span>
                </button>

                <div id="forgotPinMsg" class="info-banner" style="display: none;">
                    Please contact your admin to reset your PIN.
                </div>

                <div class="text-center">
                    <a href="#" id="forgotPinLink" class="link-primary">Forgot PIN</a>
                </div>
            </div>

            <!-- Admin Login Form -->
            <div id="adminLoginForm" class="login-form">
                <div class="form-group">
                    <label>Company Email</label>
                    <input type="email" id="adminEmail" placeholder="Enter Email">
                </div>

                <div class="form-group">
                    <label>Password</label>
                    <div class="password-input">
                        <input type="password" id="adminPassword" placeholder="Enter Password">
                        <button type="button" id="togglePassword" class="toggle-password">
                            <span class="eye-icon" id="eyeIcon">👁</span>
                        </button>
                    </div>
                </div>

                <div id="adminError" class="error-banner" style="display: none;">
                    <div class="error-icon">⚠</div>
                    <div>
                        <p id="adminErrorMsg"></p>
                    </div>
                </div>

                <button id="adminLoginBtn" class="btn btn-primary btn-large">
                    <span id="adminLoginText">Login</span>
                    <span id="adminLoginSpinner" class="spinner" style="display: none;"></span>
                </button>
            </div>

            <!-- Footer Toggle -->
            <div class="login-footer">
                <div id="mobileWarning" class="mobile-warning" style="display: none;">
                    💻 Admin access requires a desktop computer
                </div>
                <button id="toggleLoginType" class="btn btn-secondary">
                    <span id="toggleText">Admin Login</span>
                </button>
            </div>
        </div>
    </div>

    <script src="assets/js/common.js"></script>
    <script src="assets/js/login.js"></script>
</body>
</html>
