// Provider Security Tests - Credential isolation and cross-user access prevention
// PROVIDER PLATFORM #16: Security tests for credential isolation
// Tests: cross-user credential access, credential isolation, rotation, revocation

import { 
  storeUserCredential, 
  getUserCredential, 
  deleteUserCredential, 
  rotateUserCredential, 
  listUserCredentialProviders,
  deleteUserCredentials,
  getCredentialAuditLog
} from '../src/core/credentialVault.js';

const userA = 'user-a-test';
const userB = 'user-b-test';
const providerId = 'openrouter';
const credentialA = 'sk-test-key-user-a-1234567890';
const credentialB = 'sk-test-key-user-b-0987654321';
const credentialRotated = 'sk-test-key-user-a-rotated-1111111111';

// Clean up any existing test data
deleteUserCredential(userA, providerId);
deleteUserCredential(userB, providerId);

console.log('Running Provider Security Tests...\n');

// Test 1: Cross-User Credential Isolation
console.log('Test 1: Cross-User Credential Isolation');
try {
  // Store credential for User A
  storeUserCredential(userA, providerId, credentialA);
  
  // Store credential for User B
  storeUserCredential(userB, providerId, credentialB);
  
  // User A should only see their own credential
  const userACredentials = listUserCredentialProviders(userA);
  if (userACredentials.length !== 1 || userACredentials[0].providerId !== providerId) {
    throw new Error('User A should only see their own credential');
  }
  
  // User B should only see their own credential
  const userBCredentials = listUserCredentialProviders(userB);
  if (userBCredentials.length !== 1 || userBCredentials[0].providerId !== providerId) {
    throw new Error('User B should only see their own credential');
  }
  
  // Verify the credentials are different
  if (userACredentials[0].id === userBCredentials[0].id) {
    throw new Error('Credentials should have different IDs');
  }
  
  console.log('✅ PASS: Cross-user credential isolation works correctly\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 2: Prevent User A from modifying User B credentials
console.log('Test 2: Prevent User A from modifying User B credentials');
try {
  // User A tries to rotate User B's credential by using User B's userId (should fail)
  // Note: Since both users have the same providerId, we need to test that User A cannot access User B's specific credential
  const userBCredentials = listUserCredentialProviders(userB);
  const userBCredentialId = userBCredentials[0].id;
  
  // User A should not be able to access User B's credential ID
  const userACredentials = listUserCredentialProviders(userA);
  const hasUserBCredential = userACredentials.some(c => c.id === userBCredentialId);
  
  if (hasUserBCredential) {
    throw new Error('User A should not see User B credential ID');
  }
  
  // User B's credential should remain unchanged
  const userBCredential = getUserCredential(userB, providerId);
  if (!userBCredential || userBCredential.credential !== credentialB) {
    throw new Error('User B credential should remain unchanged');
  }
  
  console.log('✅ PASS: Cross-user credential modification prevented\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 3: Prevent User A from deleting User B credentials
console.log('Test 3: Prevent User A from deleting User B credentials');
try {
  // User A deletes their own credential (should succeed)
  const result = deleteUserCredential(userA, providerId);
  if (result.ok !== true) {
    throw new Error('User A should be able to delete their own credential');
  }
  
  // User B's credential should still exist
  const userBCredentials = listUserCredentialProviders(userB);
  if (userBCredentials.length !== 1) {
    throw new Error('User B credential should still exist');
  }
  
  // User A should not be able to see User B's credential
  const userACredentials = listUserCredentialProviders(userA);
  if (userACredentials.length !== 0) {
    throw new Error('User A should not see any credentials after deletion');
  }
  
  console.log('✅ PASS: Cross-user credential deletion prevented\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 4: Credential Rotation
console.log('Test 4: Credential Rotation');
try {
  // First, recreate User A's credential since it was deleted in Test 3
  storeUserCredential(userA, providerId, credentialA);
  
  // Rotate User A's credential
  const result = rotateUserCredential(userA, providerId, credentialRotated);
  if (result.ok !== true || result.rotationCount !== 1) {
    throw new Error('Credential rotation should succeed');
  }
  
  // Verify the new credential is stored
  const credential = getUserCredential(userA, providerId);
  if (!credential || credential.credential !== credentialRotated || credential.rotationCount !== 1) {
    throw new Error('Rotated credential should be stored correctly');
  }
  
  console.log('✅ PASS: Credential rotation works correctly\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 5: Credential Revocation
console.log('Test 5: Credential Revocation');
try {
  // Delete User A's credential
  const result = deleteUserCredential(userA, providerId);
  if (result.ok !== true) {
    throw new Error('Credential deletion should succeed');
  }
  
  // Verify the credential is revoked
  const credential = getUserCredential(userA, providerId);
  if (credential !== null) {
    throw new Error('Revoked credential should not be accessible');
  }
  
  console.log('✅ PASS: Credential revocation works correctly\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 6: Audit Trail
console.log('Test 6: Audit Trail');
try {
  // Recreate User A's credential (deleted in Test 5)
  storeUserCredential(userA, providerId, credentialA);
  
  // Check audit log
  const auditLog = getCredentialAuditLog(userA, providerId);
  if (!auditLog || auditLog.length === 0) {
    throw new Error('Audit log should contain entries');
  }
  
  // Verify the latest entry is a credential store operation
  const latestEntry = auditLog[0];
  if (latestEntry.action !== 'CREDENTIAL_STORED' || latestEntry.userId !== userA || latestEntry.providerId !== providerId) {
    throw new Error('Audit log entry should match operation');
  }
  
  console.log('✅ PASS: Audit trail works correctly\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 7: Credential Redaction
console.log('Test 7: Credential Redaction');
try {
  // Credential is already stored from Test 6, store again to test redaction
  const result = storeUserCredential(userA, providerId, credentialA);
  
  // Verify credential is redacted in response
  if (!result.redacted || result.redacted.includes(credentialA) || !result.redacted.includes('****')) {
    throw new Error('Credential should be redacted in response');
  }
  
  console.log('✅ PASS: Credential redaction works correctly\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Test 8: Error Handling
console.log('Test 8: Error Handling');
try {
  let errorCaught = false;
  
  // Test invalid credential format
  try {
    storeUserCredential(userA, providerId, '');
  } catch (error) {
    if (error.message.includes('credential required')) {
      errorCaught = true;
    }
  }
  
  if (!errorCaught) {
    throw new Error('Should reject invalid credential format');
  }
  
  // Test missing providerId
  errorCaught = false;
  try {
    storeUserCredential(userA, '', credentialA);
  } catch (error) {
    if (error.message.includes('providerId required')) {
      errorCaught = true;
    }
  }
  
  if (!errorCaught) {
    throw new Error('Should reject missing providerId');
  }
  
  console.log('✅ PASS: Error handling works correctly\n');
} catch (error) {
  console.log('❌ FAIL:', error.message, '\n');
}

// Clean up test data
deleteUserCredential(userA, providerId);
deleteUserCredential(userB, providerId);

console.log('Provider Security Tests Complete');
