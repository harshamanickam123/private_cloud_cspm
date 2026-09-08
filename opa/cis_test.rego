package cis

test_deny_root_login_enabled if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin yes", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active"}
    count(result) == 1
}

test_deny_password_auth_enabled if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication yes", "ufw_status": "Status: active"}
    count(result) == 1
}

test_deny_firewall_disabled if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: inactive"}
    count(result) == 1
}

test_no_violation_when_secure if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active"}
    count(result) == 0
}

test_all_violations_when_fully_misconfigured if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin yes", "password_authentication": "passwordauthentication yes", "ufw_status": "Status: inactive"}
    count(result) == 3
}
