# API Productos - Microservicio Multi-tenant para Inkafarma

Este microservicio maneja la gestión de productos (medicinas) con soporte multi-tenant usando AWS Lambda, DynamoDB y autenticación JWT.

## Características

- ✅ Multi-tenancy (soporte para múltiples inquilinos)
- ✅ Serverless con AWS Lambda
- ✅ Protegido con autenticación JWT
- ✅ CRUD completo de productos
- ✅ Paginación en listado
- ✅ DynamoDB Streams habilitado
- ✅ CORS habilitado
- ✅ Despliegue automatizado con Serverless Framework
- ✅ Manejo completo de imágenes con S3
- ✅ URLs presignadas para subida directa de imágenes
- ✅ Subida de imágenes en base64
- ✅ Eliminación automática de imágenes al eliminar productos
- ✅ Validación de tipos y tamaños de imagen

## Estructura de Productos

Cada producto contiene:
- **código**: Código único generado automáticamente (MED-xxxxx-xxxxx)
- **nombre**: Nombre del medicamento
- **precio**: Precio en soles (número decimal)
- **descripcion**: Descripción del producto
- **imagen_url**: URL de la imagen en S3
- **tenant_id**: Identificador del inquilino
- **fecha_creacion**: Timestamp de creación
- **fecha_modificacion**: Timestamp de última modificación
- **activo**: Estado del producto

## Endpoints

### 1. Listar Productos (Paginado)
- **URL**: `GET /productos/listar`
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `limit` (opcional): Número de productos por página (default: 20)
  - `lastKey` (opcional): Clave para paginación (base64 encoded)
- **Respuesta**:
```json
{
  "productos": [...],
  "count": 20,
  "nextKey": "base64_encoded_key",
  "hasMore": true
}
```

### 2. Crear Producto
- **URL**: `POST /productos/crear`
- **Headers**: `Authorization: Bearer <token>`
- **Body**:
```json
{
  "nombre": "Paracetamol 500mg",
  "precio": 12.50,
  "descripcion": "Analgésico y antipirético para dolores leves a moderados",
  "imagen_url": "https://s3.amazonaws.com/mi-bucket/paracetamol.jpg"
}
```
**O con imagen en base64**:
```json
{
  "nombre": "Paracetamol 500mg",
  "precio": 12.50,
  "descripcion": "Analgésico y antipirético para dolores leves a moderados",
  "imagen": "/9j/4AAQSkZJRgABAQEAYABgAAD..." // base64 de la imagen
}
```

### 3. Buscar Producto por Código
- **URL**: `GET /productos/buscar/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Respuesta**:
```json
{
  "producto": {
    "tenant_id": "inkafarma",
    "codigo": "MED-ABC123-DEF456",
    "nombre": "Paracetamol 500mg",
    "precio": 12.50,
    "descripcion": "Analgésico y antipirético",
    "imagen_url": "https://s3.amazonaws.com/...",
    "fecha_creacion": "2025-06-14T10:30:00Z",
    "fecha_modificacion": "2025-06-14T10:30:00Z",
    "activo": true
  }
}
```

### 4. Modificar Producto
- **URL**: `PUT /productos/modificar/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Body** (todos los campos son opcionales):
```json
{
  "nombre": "Paracetamol 500mg - Nuevo",
  "precio": 15.00,
  "descripcion": "Nueva descripción",
  "imagen_url": "https://s3.amazonaws.com/nueva-imagen.jpg",
  "activo": true
}
```
**O con nueva imagen en base64**:
```json
{
  "nombre": "Paracetamol 500mg - Nuevo",
  "precio": 15.00,
  "descripcion": "Nueva descripción",
  "imagen": "/9j/4AAQSkZJRgABAQEAYABgAAD...", // Reemplaza imagen anterior
  "activo": true
}
```

### 5. Eliminar Producto
- **URL**: `DELETE /productos/eliminar/{codigo}`
- **Headers**: `Authorization: Bearer <token>`
- **Respuesta**:
```json
{
  "message": "Producto eliminado exitosamente",
  "producto_eliminado": { ... }
}
```
**Nota**: Elimina automáticamente la imagen asociada de S3.

### 6. Subir Imagen (Independiente)
- **URL**: `POST /productos/subir-imagen`
- **Headers**: `Authorization: Bearer <token>`
- **Body**:
```json
{
  "imagen": "/9j/4AAQSkZJRgABAQEAYABgAAD...", // base64
  "codigo_producto": "MED-ABC123-DEF456"
}
```
- **Respuesta**:
```json
{
  "message": "Imagen subida exitosamente",
  "imagen_url": "https://s3.amazonaws.com/bucket/productos/tenant/codigo/timestamp.jpg",
  "key": "productos/tenant/codigo/timestamp.jpg"
}
```

### 7. Generar URL de Subida Presignada
- **URL**: `GET /productos/generar-url-subida`
- **Headers**: `Authorization: Bearer <token>`
- **Query Parameters**:
  - `codigo_producto`: Código del producto
  - `tipo_archivo`: Tipo de archivo (jpg, jpeg, png, gif, webp)
- **Respuesta**:
```json
{
  "upload_url": "https://s3.amazonaws.com/...", 
  "public_url": "https://s3.amazonaws.com/...",
  "expires_in": 600
}
```

## Instalación y Despliegue

### Prerrequisitos
- Node.js 18+
- AWS CLI configurado con credenciales válidas
- Serverless Framework (`npm install -g serverless`)
- Token JWT válido del microservicio de usuarios
- Permisos AWS para crear recursos (DynamoDB, S3, Lambda, IAM)

### Variables de Entorno

El sistema utiliza las siguientes variables de entorno (configuradas automáticamente):

- `TABLE_NAME`: `{stage}-t_productos` (auto-generado por stage)
- `JWT_SECRET`: `mi-super-secreto-jwt-2025`
- `BUCKET_NAME`: `{stage}-inkafarma-productos-imagenes` (auto-generado por stage)

### Comandos de Despliegue

```bash
# Instalar dependencias
npm install

# Desplegar a desarrollo
npm run deploy-dev

# Desplegar a testing  
npm run deploy-test

# Desplegar a producción
npm run deploy-prod

# Eliminar despliegue
npm run remove-dev
npm run remove-test  
npm run remove-prod

# Ver información del despliegue
npm run info

# Ver logs en tiempo real
npm run logs-crear
npm run logs-listar
npm run logs-buscar
npm run logs-modificar
npm run logs-eliminar
```

### Logs Adicionales (No definidos en package.json)
```bash
# Ver logs de funciones de imagen
serverless logs -f subir-imagen -t
serverless logs -f generar-url-subida -t
```

## Estructura del Proyecto

```
api-productos/
├── productos.js         # Funciones Lambda principales
├── serverless.yml       # Configuración Serverless Framework
├── package.json         # Configuración del proyecto y scripts
└── README.md           # Documentación del proyecto
```

## Tabla DynamoDB

**Nombre**: `{stage}-t_productos`

**Schema**:
- **Partition Key**: `tenant_id` (String)
- **Sort Key**: `codigo` (String)  
- **Streams**: Habilitado con NEW_AND_OLD_IMAGES
- **Billing**: PAY_PER_REQUEST

**Campos**:
- `tenant_id`: Identificador del inquilino (extraído del JWT)
- `codigo`: Código único del producto (auto-generado formato MED-xxxxx-xxxxx)
- `nombre`: Nombre del producto (requerido, trimmed)
- `precio`: Precio en soles (Number, mayor a 0)
- `descripcion`: Descripción del producto (requerido, trimmed)
- `imagen_url`: URL de imagen en S3 (opcional)
- `fecha_creacion`: Timestamp ISO de creación
- `fecha_modificacion`: Timestamp ISO de última modificación
- `activo`: Estado del producto (Boolean, default: true)

## Manejo de Imágenes

### Formatos Soportados
- **JPG/JPEG** (detectado por: `/9j/`)
- **PNG** (detectado por: `iVBORw0KGgo`)
- **GIF** (detectado por: `R0lGODlh`)
- **WEBP** (detectado por: `UklGR`)

### Límites y Validaciones
- **Tamaño máximo**: 5MB por imagen
- **Detección automática** de tipo por contenido base64
- **Validación de MIME types**: image/jpeg, image/png, image/gif, image/webp
- **ACL público** para acceso directo desde URLs

### Estructura de Almacenamiento en S3
```
s3://{stage}-inkafarma-productos-imagenes/
└── productos/
    └── {tenant_id}/
        └── {codigo_producto}/
            └── {timestamp}.{extension}
```

### Bucket S3 Configuration
- **Nombre**: `{stage}-inkafarma-productos-imagenes`
- **CORS**: Habilitado para todos los orígenes
- **Public Access**: Permitido para objetos (no para bucket policy/ACL)
- **Policy**: Permite `s3:GetObject` público en `bucket/*`

### Operaciones de Imagen
- **Creación**: Se puede incluir imagen en base64 al crear producto
- **Modificación**: Nueva imagen reemplaza y elimina la anterior automáticamente
- **Eliminación**: Al eliminar producto se elimina imagen asociada de S3
- **Subida independiente**: Endpoint separado para subir imágenes
- **URLs presignadas**: Para subida directa desde frontend (válidas 10 minutos)

## Seguridad

### Autenticación JWT
- Todos los endpoints requieren token JWT válido en header `Authorization: Bearer <token>`
- Soporte para header `authorization` (minúscula) como fallback
- Validación de expiración y firma del token
- Extracción automática de `tenant_id` desde payload JWT

### Multi-tenancy
- Aislamiento completo de datos por `tenant_id`
- Todas las operaciones filtradas automáticamente por tenant
- Imágenes organizadas por tenant en S3

### Validaciones de Datos
- Campos requeridos validados en creación
- Tipos de datos validados (números, strings, booleans)
- Sanitización de strings (trim)
- Validación de precios (mayor a 0)
- Validación de códigos de producto en paths

### CORS y Headers
- CORS habilitado para todos los orígenes (`*`)
- Headers permitidos: `Content-Type`, `X-Amz-Date`, `Authorization`, `X-Api-Key`, `X-Amz-Security-Token`
- Métodos permitidos: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

## Códigos de Estado HTTP

- **200**: Operación exitosa (GET, PUT, DELETE)
- **201**: Producto creado exitosamente (POST)
- **400**: Datos inválidos, faltantes o formato incorrecto
- **401**: Token inválido, expirado o faltante
- **404**: Producto no encontrado
- **500**: Error interno del servidor

## Generación de Códigos

Los códigos de producto se generan automáticamente con el formato:
```
MED-{timestamp_base36}-{random_6_chars}
```

Ejemplo: `MED-LKJ4H2K1-A7B9C2`

## Manejo de Errores

### Errores Comunes
- **Token JWT**: Validación de formato, expiración y firma
- **JSON malformado**: Validación de sintaxis en request body
- **Campos faltantes**: Validación de campos requeridos
- **Tipos de datos**: Validación de números, strings, etc.
- **Imágenes**: Validación de formato, tamaño y contenido base64
- **S3**: Manejo de errores de subida y eliminación

### Logs
- Todos los errores se registran en CloudWatch Logs
- Información de debug disponible para troubleshooting
- Separación de logs por función Lambda

## Dependencias

### Producción
- `aws-sdk@^2.1691.0`: SDK de AWS para DynamoDB y S3
- `jsonwebtoken@^9.0.2`: Validación de tokens JWT

### Desarrollo  
- `serverless@^3.38.0`: Framework de despliegue serverless

## Configuración AWS

### IAM Role
- **Role ARN**: `arn:aws:iam::409362080365:role/LabRole`
- **Permisos requeridos**:
  - DynamoDB: `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`
  - S3: `GetObject`, `PutObject`, `DeleteObject`, `GetSignedUrl`
  - CloudWatch: `CreateLogGroup`, `CreateLogStream`, `PutLogEvents`

### Recursos Creados Automáticamente
- Tabla DynamoDB con streams habilitado
- Bucket S3 con configuración CORS y policy pública
- Funciones Lambda con configuración de memoria y timeout
- API Gateway con endpoints y CORS
- CloudWatch Log Groups para cada función