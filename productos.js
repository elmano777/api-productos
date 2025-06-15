import { DynamoDB, S3 } from 'aws-sdk';
import { verify } from 'jsonwebtoken';

// Clientes AWS
const dynamodb = new DynamoDB.DocumentClient();
const s3 = new S3();
const tableName = process.env.TABLE_NAME;
const bucketName = process.env.BUCKET_NAME;
const jwtSecret = process.env.JWT_SECRET;

// Función helper para respuestas consistentes
const lambdaResponse = (statusCode, body) => {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify(body)
    };
};

// Función para validar token JWT
const validarToken = (event) => {
    try {
        let token = null;
        
        // Buscar token en headers Authorization
        if (event.headers && event.headers.Authorization) {
            const authHeader = event.headers.Authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }
        
        // Buscar token en headers authorization (minúscula)
        if (!token && event.headers && event.headers.authorization) {
            const authHeader = event.headers.authorization;
            if (authHeader.startsWith('Bearer ')) {
                token = authHeader.substring(7);
            }
        }
        
        if (!token) {
            return { valid: false, error: 'Token requerido' };
        }
        
        const payload = verify(token, jwtSecret);
        return { valid: true, usuario: payload };
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return { valid: false, error: 'Token expirado' };
        } else if (error.name === 'JsonWebTokenError') {
            return { valid: false, error: 'Token inválido' };
        }
        return { valid: false, error: 'Error validando token' };
    }
};

// Función para generar código único de producto
const generarCodigoProducto = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `MED-${timestamp}-${random}`.toUpperCase();
};

// Función para generar nombre único de archivo
const generarNombreArchivo = (tenantId, codigo, extension) => {
    const timestamp = Date.now();
    return `productos/${tenantId}/${codigo}/${timestamp}.${extension}`;
};

// Função para detectar tipo de archivo por su contenido
const detectarTipoImagen = (base64String) => {
    if (base64String.startsWith('/9j/')) return { ext: 'jpg', mime: 'image/jpeg' };
    if (base64String.startsWith('iVBORw0KGgo')) return { ext: 'png', mime: 'image/png' };
    if (base64String.startsWith('R0lGODlh')) return { ext: 'gif', mime: 'image/gif' };
    if (base64String.startsWith('UklGR')) return { ext: 'webp', mime: 'image/webp' };
    return null;
};

// Función para procesar form-data
const procesarFormData = (body) => {
    const boundary = body.split('\r\n')[0];
    const parts = body.split(boundary);
    const result = {};
    
    for (const part of parts) {
        if (part.includes('Content-Disposition: form-data')) {
            const nameMatch = part.match(/name="([^"]+)"/);
            if (nameMatch) {
                const name = nameMatch[1];
                const value = part.split('\r\n\r\n')[1]?.split('\r\n')[0];
                if (value) {
                    result[name] = value;
                }
            }
        }
    }
    return result;
};

// Subir imagen a S3
export async function subirImagen(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return lambdaResponse(400, { error: 'JSON inválido' });
        }
        
        // Validar campos requeridos
        if (!body.imagen || !body.codigo_producto) {
            return lambdaResponse(400, { error: 'Campos requeridos: imagen (base64), codigo_producto' });
        }
        
        // Detectar tipo de imagen
        const tipoImagen = detectarTipoImagen(body.imagen);
        if (!tipoImagen) {
            return lambdaResponse(400, { error: 'Formato de imagen no soportado. Solo JPG, PNG, GIF, WEBP' });
        }
        
        // Convertir base64 a buffer
        let imageBuffer;
        try {
            imageBuffer = Buffer.from(body.imagen, 'base64');
        } catch (e) {
            return lambdaResponse(400, { error: 'Imagen base64 inválida' });
        }
        
        // Validar tamaño (máximo 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (imageBuffer.length > maxSize) {
            return lambdaResponse(400, { error: 'Imagen muy grande. Máximo 5MB' });
        }
        
        // Generar nombre único del archivo
        const nombreArchivo = generarNombreArchivo(tenantId, body.codigo_producto, tipoImagen.ext);
        
        // Subir a S3
        const uploadParams = {
            Bucket: bucketName,
            Key: nombreArchivo,
            Body: imageBuffer,
            ContentType: tipoImagen.mime,
            ACL: 'public-read' // Para que sea accesible públicamente
        };
        
        const uploadResult = await s3.upload(uploadParams).promise();
        
        return lambdaResponse(200, {
            message: 'Imagen subida exitosamente',
            imagen_url: uploadResult.Location,
            key: nombreArchivo
        });
        
    } catch (error) {
        console.error('Error subiendo imagen:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Generar URL presignada para subida directa (alternativa)
export async function generarUrlSubida(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const queryParams = event.queryStringParameters || {};
        
        if (!queryParams.codigo_producto || !queryParams.tipo_archivo) {
            return lambdaResponse(400, { error: 'Parámetros requeridos: codigo_producto, tipo_archivo' });
        }
        
        const tiposPermitidos = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const tipoArchivo = queryParams.tipo_archivo.toLowerCase();
        
        if (!tiposPermitidos.includes(tipoArchivo)) {
            return lambdaResponse(400, { error: 'Tipo de archivo no permitido' });
        }
        
        const nombreArchivo = generarNombreArchivo(tenantId, queryParams.codigo_producto, tipoArchivo);
        
        // Generar URL presignada (válida por 10 minutos)
        const signedUrl = s3.getSignedUrl('putObject', {
            Bucket: bucketName,
            Key: nombreArchivo,
            ContentType: `image/${tipoArchivo === 'jpg' ? 'jpeg' : tipoArchivo}`,
            ACL: 'public-read',
            Expires: 600 // 10 minutos
        });
        
        const publicUrl = `https://${bucketName}.s3.amazonaws.com/${nombreArchivo}`;
        
        return lambdaResponse(200, {
            upload_url: signedUrl,
            public_url: publicUrl,
            expires_in: 600
        });
        
    } catch (error) {
        console.error('Error generando URL presignada:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Listar productos con paginación
export async function listarProductos(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const queryParams = event.queryStringParameters || {};
        const limit = parseInt(queryParams.limit) || 20;
        let lastEvaluatedKey = null;
        
        if (queryParams.lastKey) {
            try {
                lastEvaluatedKey = JSON.parse(Buffer.from(queryParams.lastKey, 'base64').toString());
            } catch (e) {
                return lambdaResponse(400, { error: 'lastKey inválido' });
            }
        }
        
        const params = {
            TableName: tableName,
            KeyConditionExpression: 'tenant_id = :tenant_id',
            ExpressionAttributeValues: {
                ':tenant_id': tenantId
            },
            Limit: limit,
            ScanIndexForward: false // Ordenar por fecha de creación descendente
        };
        
        if (lastEvaluatedKey) {
            params.ExclusiveStartKey = lastEvaluatedKey;
        }
        
        const result = await dynamodb.query(params).promise();
        
        let nextKey = null;
        if (result.LastEvaluatedKey) {
            nextKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
        }
        
        return lambdaResponse(200, {
            productos: result.Items,
            count: result.Items.length,
            nextKey: nextKey,
            hasMore: !!result.LastEvaluatedKey
        });
        
    } catch (error) {
        console.error('Error listando productos:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Crear producto (puede incluir imagen)
export async function crearProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        
        let body;
        let contentType = event.headers['Content-Type'] || event.headers['content-type'];
        
        if (contentType && contentType.includes('multipart/form-data')) {
            // Procesar form-data
            body = procesarFormData(event.body);
        } else {
            try {
                body = JSON.parse(event.body);
            } catch (e) {
                return lambdaResponse(400, { error: 'Formato de datos inválido. Use multipart/form-data o JSON' });
            }
        }
        
        // Validar campos requeridos
        const requiredFields = ['nombre', 'precio', 'descripcion'];
        for (const field of requiredFields) {
            if (!body[field]) {
                return lambdaResponse(400, { error: `Campo requerido: ${field}` });
            }
        }
        
        // Validar precio
        const precio = parseFloat(body.precio);
        if (isNaN(precio) || precio <= 0) {
            return lambdaResponse(400, { error: 'Precio debe ser un número mayor a 0' });
        }
        
        const codigo = generarCodigoProducto();
        const fechaCreacion = new Date().toISOString();
        
        let imagenUrl = '';
        
        // Si se proporciona imagen en form-data
        if (body.imagen) {
            try {
                // La imagen viene en base64 desde el form-data
                const tipoImagen = detectarTipoImagen(body.imagen);
                if (!tipoImagen) {
                    return lambdaResponse(400, { error: 'Formato de imagen no soportado' });
                }
                
                const imageBuffer = Buffer.from(body.imagen, 'base64');
                
                // Validar tamaño
                const maxSize = 5 * 1024 * 1024; // 5MB
                if (imageBuffer.length > maxSize) {
                    return lambdaResponse(400, { error: 'Imagen muy grande. Máximo 5MB' });
                }
                
                const nombreArchivo = generarNombreArchivo(tenantId, codigo, tipoImagen.ext);
                
                const uploadParams = {
                    Bucket: bucketName,
                    Key: nombreArchivo,
                    Body: imageBuffer,
                    ContentType: tipoImagen.mime,
                    ACL: 'public-read'
                };
                
                const uploadResult = await s3.upload(uploadParams).promise();
                imagenUrl = uploadResult.Location;
                
            } catch (uploadError) {
                console.error('Error subiendo imagen:', uploadError);
                return lambdaResponse(400, { error: 'Error procesando imagen' });
            }
        } else if (body.imagen_url) {
            // Si se proporciona URL directamente
            imagenUrl = body.imagen_url;
        }
        
        const producto = {
            tenant_id: tenantId,
            codigo: codigo,
            nombre: body.nombre.trim(),
            precio: precio,
            descripcion: body.descripcion.trim(),
            imagen_url: imagenUrl,
            fecha_creacion: fechaCreacion,
            fecha_modificacion: fechaCreacion,
            activo: true
        };
        
        const params = {
            TableName: tableName,
            Item: producto
        };
        
        await dynamodb.put(params).promise();
        
        return lambdaResponse(201, {
            message: 'Producto creado exitosamente',
            producto: producto
        });
        
    } catch (error) {
        console.error('Error creando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Buscar producto por código
export async function buscarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
        }
        
        const params = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const result = await dynamodb.get(params).promise();
        
        if (!result.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        return lambdaResponse(200, {
            producto: result.Item
        });
        
    } catch (error) {
        console.error('Error buscando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Modificar producto (puede incluir nueva imagen)
export async function modificarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
        }
        
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            return lambdaResponse(400, { error: 'JSON inválido' });
        }
        
        // Verificar que el producto existe
        const getParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const existingProduct = await dynamodb.get(getParams).promise();
        if (!existingProduct.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        // Construir expresión de actualización
        let updateExpression = 'SET fecha_modificacion = :fecha_modificacion';
        let expressionAttributeValues = {
            ':fecha_modificacion': new Date().toISOString()
        };
        let expressionAttributeNames = {};
        
        // Manejar imagen si se proporciona
        if (body.imagen) {
            try {
                const tipoImagen = detectarTipoImagen(body.imagen);
                if (!tipoImagen) {
                    return lambdaResponse(400, { error: 'Formato de imagen no soportado' });
                }
                
                const imageBuffer = Buffer.from(body.imagen, 'base64');
                
                // Validar tamaño
                const maxSize = 5 * 1024 * 1024; // 5MB
                if (imageBuffer.length > maxSize) {
                    return lambdaResponse(400, { error: 'Imagen muy grande. Máximo 5MB' });
                }
                
                // Eliminar imagen anterior si existe
                if (existingProduct.Item.imagen_url) {
                    try {
                        const oldImageKey = existingProduct.Item.imagen_url.split('.com/')[1]; // Extraer key de la URL
                        if (oldImageKey && oldImageKey.startsWith('productos/')) {
                            await s3.deleteObject({ Bucket: bucketName, Key: oldImageKey }).promise();
                        }
                    } catch (deleteError) {
                        console.warn('No se pudo eliminar imagen anterior:', deleteError);
                    }
                }
                
                const nombreArchivo = generarNombreArchivo(tenantId, codigo, tipoImagen.ext);
                
                const uploadParams = {
                    Bucket: bucketName,
                    Key: nombreArchivo,
                    Body: imageBuffer,
                    ContentType: tipoImagen.mime,
                    ACL: 'public-read'
                };
                
                const uploadResult = await s3.upload(uploadParams).promise();
                
                updateExpression += `, imagen_url = :imagen_url`;
                expressionAttributeValues[':imagen_url'] = uploadResult.Location;
                
            } catch (uploadError) {
                console.error('Error subiendo nueva imagen:', uploadError);
                return lambdaResponse(400, { error: 'Error procesando imagen' });
            }
        }
        
        // Campos que se pueden actualizar (además de imagen)
        const updatableFields = ['nombre', 'precio', 'descripcion', 'imagen_url', 'activo'];
        
        for (const field of updatableFields) {
            if (body[field] !== undefined && field !== 'imagen_url') { // imagen_url se maneja arriba
                if (field === 'precio') {
                    const precio = parseFloat(body[field]);
                    if (isNaN(precio) || precio <= 0) {
                        return lambdaResponse(400, { error: 'Precio debe ser un número mayor a 0' });
                    }
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = precio;
                } else if (field === 'nombre' || field === 'descripcion') {
                    if (typeof body[field] !== 'string' || !body[field].trim()) {
                        return lambdaResponse(400, { error: `${field} no puede estar vacío` });
                    }
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = body[field].trim();
                } else {
                    updateExpression += `, #${field} = :${field}`;
                    expressionAttributeNames[`#${field}`] = field;
                    expressionAttributeValues[`:${field}`] = body[field];
                }
            }
        }
        
        const updateParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        };
        
        if (Object.keys(expressionAttributeNames).length > 0) {
            updateParams.ExpressionAttributeNames = expressionAttributeNames;
        }
        
        const result = await dynamodb.update(updateParams).promise();
        
        return lambdaResponse(200, {
            message: 'Producto modificado exitosamente',
            producto: result.Attributes
        });
        
    } catch (error) {
        console.error('Error modificando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}

// Eliminar producto (incluye eliminación de imagen)
export async function eliminarProducto(event, context) {
    try {
        // Validar token
        const tokenValidation = validarToken(event);
        if (!tokenValidation.valid) {
            return lambdaResponse(401, { error: tokenValidation.error });
        }
        
        const tenantId = tokenValidation.usuario.tenant_id;
        const codigo = event.pathParameters?.codigo;
        
        if (!codigo) {
            return lambdaResponse(400, { error: 'Código de producto requerido' });
        }
        
        // Obtener producto antes de eliminar
        const getParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            }
        };
        
        const existingProduct = await dynamodb.get(getParams).promise();
        if (!existingProduct.Item) {
            return lambdaResponse(404, { error: 'Producto no encontrado' });
        }
        
        // Eliminar imagen de S3 si existe
        if (existingProduct.Item.imagen_url) {
            try {
                const imageKey = existingProduct.Item.imagen_url.split('.com/')[1]; // Extraer key de la URL
                if (imageKey && imageKey.startsWith('productos/')) {
                    await s3.deleteObject({ Bucket: bucketName, Key: imageKey }).promise();
                }
            } catch (deleteError) {
                console.warn('No se pudo eliminar imagen:', deleteError);
                // Continuar con la eliminación del producto aunque falle la imagen
            }
        }
        
        const deleteParams = {
            TableName: tableName,
            Key: {
                tenant_id: tenantId,
                codigo: codigo
            },
            ReturnValues: 'ALL_OLD'
        };
        
        const result = await dynamodb.delete(deleteParams).promise();
        
        return lambdaResponse(200, {
            message: 'Producto eliminado exitosamente',
            producto_eliminado: result.Attributes
        });
        
    } catch (error) {
        console.error('Error eliminando producto:', error);
        return lambdaResponse(500, { error: 'Error interno del servidor' });
    }
}