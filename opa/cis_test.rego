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
test_deny_max_auth_tries_too_high if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 6", "x11_forwarding": "x11forwarding no", "unattended_upgrades": "enabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90"}
    count(result) == 1
}

test_deny_x11_forwarding_enabled if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 4", "x11_forwarding": "x11forwarding yes", "unattended_upgrades": "enabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90"}
    count(result) == 1
}

test_deny_updates_disabled if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 4", "x11_forwarding": "x11forwarding no", "unattended_upgrades": "disabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90"}
    count(result) == 1
}

test_fully_compliant_host_has_no_violations if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 4", "x11_forwarding": "x11forwarding no", "unattended_upgrades": "enabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90"}
    count(result) == 0
}
test_deny_login_grace_time_too_high if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 4", "x11_forwarding": "x11forwarding no", "unattended_upgrades": "enabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90", "login_grace_time": "logingracetime 120", "log_level": "loglevel INFO", "passwd_perms": "644", "shadow_perms": "640", "suid_dumpable": "0"}
    count(result) == 1
}

test_deny_suid_dumpable_enabled if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 4", "x11_forwarding": "x11forwarding no", "unattended_upgrades": "enabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90", "login_grace_time": "logingracetime 60", "log_level": "loglevel INFO", "passwd_perms": "644", "shadow_perms": "640", "suid_dumpable": "2"}
    count(result) == 1
}

test_fully_compliant_host_has_no_violations_v2 if {
    result := deny with input as {"hostname": "test-host", "permit_root_login": "permitrootlogin no", "password_authentication": "passwordauthentication no", "ufw_status": "Status: active", "max_auth_tries": "maxauthtries 4", "x11_forwarding": "x11forwarding no", "unattended_upgrades": "enabled", "permit_empty_passwords": "permitemptypasswords no", "ignore_rhosts": "ignorerhosts yes", "client_alive_interval": "clientaliveinterval 300", "pass_max_days": "90", "login_grace_time": "logingracetime 60", "log_level": "loglevel INFO", "passwd_perms": "644", "shadow_perms": "640", "suid_dumpable": "0"}
    count(result) == 0
}
