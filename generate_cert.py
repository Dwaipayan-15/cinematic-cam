# generate_cert.py
# Run: python generate_cert.py
# Creates cert.pem and key.pem without needing openssl installed

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import datetime, ipaddress, socket

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

print("Generating SSL certificate...")

# Generate private key
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

local_ip = get_local_ip()
print(f"Your local IP: {local_ip}")

subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COMMON_NAME, u"cineml"),
])

# Build certificate with both localhost AND your local IP as valid names
cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.utcnow())
    .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
    .add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName(u"localhost"),
            x509.IPAddress(ipaddress.IPv4Address(u"127.0.0.1")),
            x509.IPAddress(ipaddress.IPv4Address(local_ip)),
        ]),
        critical=False,
    )
    .sign(key, hashes.SHA256())
)

# Save key
with open("key.pem", "wb") as f:
    f.write(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption()
    ))

# Save cert
with open("cert.pem", "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))

print("")
print("SUCCESS! Created:")
print("  cert.pem")
print("  key.pem")
print("")
print("Now run: python server.py")
