/*
    This file is part of the WebKit open source project.
    This file has been generated by generate-bindings.pl. DO NOT MODIFY!

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#pragma once

#include "root.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/NeverDestroyed.h>

#include "BufferEncodingType.h"
#include "headers-handwritten.h"

extern "C" JSC::EncodedJSValue JSBuffer__bufferFromLength(JSC::JSGlobalObject* lexicalGlobalObject, int64_t length);
extern "C" JSC::EncodedJSValue JSBuffer__bufferFromPointerAndLengthAndDeinit(JSC::JSGlobalObject* lexicalGlobalObject, char* ptr, size_t length, void* ctx, JSTypedArrayBytesDeallocator bytesDeallocator);
extern "C" JSC::EncodedJSValue Bun__encoding__toString(const uint8_t* input, size_t len, JSC::JSGlobalObject* globalObject, Encoding encoding);
extern "C" JSC::EncodedJSValue Bun__encoding__toStringUTF8(const uint8_t* input, size_t len, JSC::JSGlobalObject* globalObject);
extern "C" bool Bun__Buffer_fill(ZigString*, void*, size_t, WebCore::BufferEncodingType);
extern "C" bool JSBuffer__isBuffer(JSC::JSGlobalObject*, JSC::EncodedJSValue);

namespace WebCore {

JSC::JSUint8Array* createUninitializedBuffer(JSC::JSGlobalObject* lexicalGlobalObject, size_t length);
JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const uint8_t* data, size_t length);
JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const Vector<uint8_t>& data);
JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const std::span<const uint8_t> data);
JSC::JSUint8Array* createBuffer(JSC::JSGlobalObject* lexicalGlobalObject, const char* ptr, size_t length);
JSC::JSUint8Array* createEmptyBuffer(JSC::JSGlobalObject* lexicalGlobalObject);

JSC::EncodedJSValue constructSlowBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame);
JSC::JSObject* createBufferPrototype(JSC::VM&, JSC::JSGlobalObject*);
JSC::Structure* createBufferStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);
JSC::JSObject* createBufferConstructor(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* bufferPrototype);

}